-- AL-BUHARI XEROX & STATIONERY: Supabase schema
-- Run the complete file in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'AL-BUHARI XEROX & STATIONERY',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.current_shop_id()
returns uuid language sql stable security definer set search_path=public
as $$ select shop_id from public.profiles where id=auth.uid() $$;

create or replace function public.is_shop_owner()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='owner') $$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id) on delete cascade,
  name text not null,
  category text not null,
  sku text,
  unit text not null default 'pcs',
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  low_stock_level numeric(14,2) not null default 5 check (low_stock_level >= 0),
  track_stock boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null default public.current_shop_id() references public.shops(id) on delete cascade,
  invoice_no text not null,
  customer_name text not null default 'Walk-in customer',
  customer_phone text,
  payment_method text not null default 'cash',
  subtotal numeric(14,2) not null,
  discount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(shop_id, invoice_no)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id),
  item_name text not null,
  quantity numeric(14,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  product_id uuid not null references public.products(id),
  movement_type text not null check (movement_type in ('opening','sale','purchase','adjustment')),
  quantity_change numeric(14,2) not null,
  note text,
  reference_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists products_shop_name_idx on public.products(shop_id,name);
create index if not exists invoices_shop_created_idx on public.invoices(shop_id,created_at desc);
create index if not exists movements_shop_created_idx on public.stock_movements(shop_id,created_at desc);

-- New self-registered accounts become the owner of a new shop.
-- Invited staff receive shop_id and role in auth user metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_shop uuid; v_role text;
begin
  v_shop := nullif(new.raw_user_meta_data->>'shop_id','')::uuid;
  v_role := coalesce(new.raw_user_meta_data->>'role','owner');
  if v_shop is null then
    insert into public.shops(name) values(coalesce(new.raw_user_meta_data->>'shop_name','AL-BUHARI XEROX & STATIONERY')) returning id into v_shop;
    v_role := 'owner';
  end if;
  insert into public.profiles(id,shop_id,full_name,email,role)
  values(new.id,v_shop,new.raw_user_meta_data->>'full_name',new.email,v_role);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Safe stock adjustment: updates quantity and records an audit movement.
create or replace function public.adjust_stock(p_product_id uuid,p_new_quantity numeric,p_note text default null)
returns void language plpgsql security definer set search_path=public
as $$
declare p public.products%rowtype; v_delta numeric;
begin
  select * into p from public.products where id=p_product_id and shop_id=public.current_shop_id() for update;
  if not found then raise exception 'Product not found'; end if;
  if p_new_quantity < 0 then raise exception 'Stock cannot be negative'; end if;
  v_delta := p_new_quantity-p.quantity;
  update public.products set quantity=p_new_quantity where id=p_product_id;
  insert into public.stock_movements(shop_id,product_id,movement_type,quantity_change,note,created_by)
  values(p.shop_id,p.id,'adjustment',v_delta,coalesce(p_note,'Manual adjustment'),auth.uid());
end $$;

create or replace function public.receive_stock(p_product_id uuid,p_quantity numeric,p_unit_cost numeric default 0,p_supplier text default null)
returns void language plpgsql security definer set search_path=public
as $$
declare p public.products%rowtype;
begin
  if p_quantity <= 0 then raise exception 'Purchase quantity must be greater than zero'; end if;
  select * into p from public.products where id=p_product_id and shop_id=public.current_shop_id() for update;
  if not found or not p.track_stock then raise exception 'Stock-tracked product not found'; end if;
  update public.products set quantity=quantity+p_quantity,
    purchase_price=case when p_unit_cost>0 then p_unit_cost else purchase_price end
    where id=p_product_id;
  insert into public.stock_movements(shop_id,product_id,movement_type,quantity_change,note,created_by)
  values(p.shop_id,p.id,'purchase',p_quantity,
    case when p_supplier is null then 'Purchase received' else 'Supplier: '||p_supplier end,auth.uid());
end $$;

-- Atomic billing: validates all stock, creates invoice, deducts stock and writes movements
-- in one database transaction. Concurrent checkout cannot oversell the same item.
create or replace function public.create_invoice(
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_discount numeric,
  p_items jsonb
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_shop uuid := public.current_shop_id();
  v_invoice_id uuid;
  v_invoice_no text;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := greatest(coalesce(p_discount,0),0);
  v_total numeric(14,2);
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_price numeric;
  v_line numeric;
begin
  if v_shop is null then raise exception 'Account is not linked to a shop'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one bill item'; end if;

  -- Lock products in a stable order to reduce deadlocks on simultaneous bills.
  for v_item in
    select value from jsonb_array_elements(p_items) order by (value->>'product_id')
  loop
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    if v_qty <= 0 or v_price < 0 then raise exception 'Invalid quantity or price'; end if;
    select * into v_product from public.products
      where id=(v_item->>'product_id')::uuid and shop_id=v_shop for update;
    if not found then raise exception 'An item is no longer available'; end if;
    if v_product.track_stock and v_product.quantity < v_qty then
      raise exception 'Insufficient stock for %. Available: %, requested: %',v_product.name,v_product.quantity,v_qty;
    end if;
    v_subtotal := v_subtotal + (v_qty*v_price);
  end loop;

  if v_discount > v_subtotal then raise exception 'Discount cannot exceed subtotal'; end if;
  v_total := v_subtotal-v_discount;
  v_invoice_no := 'AB-'||to_char(now(),'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));

  insert into public.invoices(shop_id,invoice_no,customer_name,customer_phone,payment_method,subtotal,discount,grand_total,created_by)
  values(v_shop,v_invoice_no,coalesce(nullif(p_customer_name,''),'Walk-in customer'),p_customer_phone,
    coalesce(p_payment_method,'cash'),v_subtotal,v_discount,v_total,auth.uid())
  returning id into v_invoice_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.products
      where id=(v_item->>'product_id')::uuid and shop_id=v_shop for update;
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_line := v_qty*v_price;
    insert into public.invoice_items(shop_id,invoice_id,product_id,item_name,quantity,unit_price,line_total)
    values(v_shop,v_invoice_id,v_product.id,v_product.name,v_qty,v_price,v_line);
    if v_product.track_stock then
      update public.products set quantity=quantity-v_qty where id=v_product.id;
      insert into public.stock_movements(shop_id,product_id,movement_type,quantity_change,note,reference_id,created_by)
      values(v_shop,v_product.id,'sale',-v_qty,'Sold on bill '||v_invoice_no,v_invoice_id,auth.uid());
    end if;
  end loop;

  return jsonb_build_object('id',v_invoice_id,'invoice_no',v_invoice_no,'subtotal',v_subtotal,'grand_total',v_total);
end $$;

alter table public.shops enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.stock_movements enable row level security;

create policy "members read own shop" on public.shops for select using(id=public.current_shop_id());
create policy "owner update own shop" on public.shops for update using(id=public.current_shop_id() and public.is_shop_owner()) with check(id=public.current_shop_id());
create policy "members read own profiles" on public.profiles for select using(shop_id=public.current_shop_id());
create policy "members update own profile" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid() and shop_id=public.current_shop_id());
create policy "members manage products" on public.products for all using(shop_id=public.current_shop_id()) with check(shop_id=public.current_shop_id());
create policy "members manage customers" on public.customers for all using(shop_id=public.current_shop_id()) with check(shop_id=public.current_shop_id());
create policy "members read invoices" on public.invoices for select using(shop_id=public.current_shop_id());
create policy "members read invoice items" on public.invoice_items for select using(shop_id=public.current_shop_id());
create policy "members read stock movements" on public.stock_movements for select using(shop_id=public.current_shop_id());

grant execute on function public.adjust_stock(uuid,numeric,text) to authenticated;
grant execute on function public.receive_stock(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.create_invoice(text,text,text,numeric,jsonb) to authenticated;

-- Realtime sync for the main tables. Enable replica identity for useful update payloads.
alter table public.products replica identity full;
alter table public.invoices replica identity full;
alter table public.stock_movements replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.invoices;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.stock_movements;
exception when duplicate_object then null; when undefined_object then null; end $$;
