import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LayoutDashboard, Package, ReceiptText, ShoppingCart, Users, BarChart3,
  Settings, LogOut, Plus, Search, RefreshCw, AlertTriangle, Menu, X,
  Printer, Trash2, CheckCircle2, Boxes, ClipboardList, Store, ShieldCheck
} from "lucide-react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const CATEGORIES = ["Stationery items", "Paper and Xerox materials", "Binding materials", "Photo printing materials", "Xerox / Printing services"];
const money = n => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n || 0));
const today = () => new Date().toISOString().slice(0,10);

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [shop, setShop] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({data}) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !supabase) { setProfile(null); setShop(null); setLoading(false); return; }
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("profiles").select("*, shops(*)").eq("id", session.user.id).single();
      if (active) {
        if (error) setNotice(error.message);
        else { setProfile(data); setShop(data.shops); }
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!session || !supabase) return;
    const channel = supabase.channel("shop-live-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => setRefreshKey(x => x + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => setRefreshKey(x => x + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_movements" }, () => setRefreshKey(x => x + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  const flash = msg => { setNotice(msg); setTimeout(() => setNotice(""), 4200); };
  const signOut = async () => supabase?.auth.signOut();

  if (!supabase) return <SetupScreen />;
  if (loading) return <div className="loading"><div className="spinner"/><p>Loading AL-BUHARI…</p></div>;
  if (!session) return <AuthScreen flash={flash} />;
  if (!profile || !shop) return <div className="loading"><p>Your account is not linked to a shop. Ask the owner to check the setup.</p><button onClick={signOut}>Sign out</button></div>;

  const nav = [
    ["dashboard","Dashboard",LayoutDashboard],["billing","New billing",ReceiptText],
    ["inventory","Stock register",Package],["purchases","Purchase entry",ShoppingCart],
    ["customers","Customers",Users],["reports","Reports",BarChart3],
    ...(profile.role === "owner" ? [["staff","Staff access",ShieldCheck]] : []),
    ["settings","Settings",Settings]
  ];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <div className="brand"><img className="brand-logo" src="/al-buhari-logo.png" alt="Al-Buhari Xerox & Stationery logo"/><div><b>AL-BUHARI</b><small>XEROX & STATIONERY</small></div><button className="close-nav" onClick={()=>setMobileNav(false)}><X/></button></div>
      <div className="shop-chip"><Store size={16}/><span>{shop.name}</span></div>
      <div className="nav-label">WORKSPACE</div>
      {nav.map(([id,label,Icon])=><button key={id} className={`nav-item ${page===id?"active":""}`} onClick={()=>{setPage(id);setMobileNav(false)}}><Icon size={18}/><span>{label}</span></button>)}
      <div className="sidebar-bottom"><div className="user-card"><div className="avatar">{(session.user.email||"U")[0].toUpperCase()}</div><div className="user-meta"><b>{profile.full_name || session.user.email}</b><small>{profile.role === "owner" ? "Owner" : "Staff"}</small></div></div><button className="signout" onClick={signOut}><LogOut size={17}/> Sign out</button></div>
    </aside>
    {mobileNav && <div className="scrim" onClick={()=>setMobileNav(false)}/>}
    <main className="main">
      <header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(true)}><Menu/></button><div><span className="eyebrow">AL-BUHARI MANAGEMENT</span><h1>{nav.find(n=>n[0]===page)?.[1] || "Dashboard"}</h1></div><div className="top-actions"><span className="live-dot">● Live sync</span><button className="icon-btn" title="Refresh" onClick={()=>setRefreshKey(x=>x+1)}><RefreshCw size={17}/></button><div className="avatar">{(session.user.email||"U")[0].toUpperCase()}</div></div></header>
      {notice && <div className="toast"><CheckCircle2 size={17}/>{notice}<button onClick={()=>setNotice("")}>×</button></div>}
      <div className="content" key={page}>
        {page==="dashboard" && <Dashboard flash={flash} refreshKey={refreshKey} setPage={setPage}/>}
        {page==="inventory" && <Inventory flash={flash} profile={profile} refreshKey={refreshKey}/>}
        {page==="billing" && <Billing flash={flash} profile={profile} refreshKey={refreshKey}/>}
        {page==="purchases" && <Purchases flash={flash} profile={profile}/>}
        {page==="customers" && <Customers flash={flash}/>}
        {page==="reports" && <Reports refreshKey={refreshKey}/>}
        {page==="staff" && <Staff flash={flash} profile={profile}/>}
        {page==="settings" && <SettingsPage shop={shop} profile={profile} flash={flash}/>}
      </div>
      <footer>AL-BUHARI XEROX & STATIONERY <span>•</span> Cloud stock & billing</footer>
    </main>
  </div>;
}

function SetupScreen() {
  return <div className="auth-wrap"><div className="auth-card"><img className="auth-logo" src="/al-buhari-logo.png" alt="Al-Buhari Xerox & Stationery logo"/><h1>AL-BUHARI</h1><p className="muted">Xerox & Stationery · Stock & Billing</p><div className="setup-alert"><AlertTriangle/> <b>Cloud connection not configured</b><p>Follow the README instructions: create a Supabase project, run the database SQL, then add your project URL and anon key to the <code>.env</code> file.</p></div></div></div>;
}

function AuthScreen({flash}) {
  const [mode,setMode]=useState("login"), [email,setEmail]=useState(""), [password,setPassword]=useState(""), [name,setName]=useState(""), [busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();setBusy(true);
    const result=mode==="login" ? await supabase.auth.signInWithPassword({email,password}) : await supabase.auth.signUp({email,password,options:{data:{full_name:name,shop_name:"AL-BUHARI XEROX & STATIONERY"}}});
    setBusy(false); if(result.error) flash(result.error.message); else if(mode==="signup") flash("Account created. Check your email if confirmation is enabled, then sign in.");
  };
  return <div className="auth-wrap"><div className="auth-card"><img className="auth-logo" src="/al-buhari-logo.png" alt="Al-Buhari Xerox & Stationery logo"/><h1>AL-BUHARI</h1><p className="muted">Xerox & Stationery · Stock & Billing</p><div className="auth-tabs"><button className={mode==="login"?"selected":""} onClick={()=>setMode("login")}>Sign in</button><button className={mode==="signup"?"selected":""} onClick={()=>setMode("signup")}>Create owner account</button></div><form onSubmit={submit}>{mode==="signup"&&<Field label="Your name"><input required value={name} onChange={e=>setName(e.target.value)} placeholder="Owner name"/></Field>}<Field label="Email address"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></Field><Field label="Password"><input type="password" required minLength="6" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></Field><button className="primary full" disabled={busy}>{busy?"Please wait…":mode==="login"?"Sign in":"Create owner account"}</button></form><p className="tiny muted">Staff accounts must be invited by the shop owner.</p></div></div>;
}

function Field({label,children}) { return <label className="field"><span>{label}</span>{children}</label>; }
function useRows(table, refreshKey=0, order="created_at") {
  const [rows,setRows]=useState([]), [busy,setBusy]=useState(true), [error,setError]=useState("");
  useEffect(()=>{let live=true;(async()=>{setBusy(true);const q=supabase.from(table).select("*").order(order,{ascending:false});const {data,error}=await q;if(live){setRows(data||[]);setError(error?.message||"");setBusy(false)}})();return()=>{live=false}},[table,refreshKey,order]);
  return {rows,setRows,busy,error,reload:async()=>{const {data,error}=await supabase.from(table).select("*").order(order,{ascending:false});if(!error)setRows(data||[]);}};
}
function Stat({label,value,sub,icon:Icon,accent=""}) { return <div className="stat-card"><div className={`stat-icon ${accent}`}><Icon size={19}/></div><div><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div></div>; }

function Dashboard({refreshKey,setPage}) {
  const {rows:products}=useRows("products",refreshKey,"name"), {rows:invoices}=useRows("invoices",refreshKey), {rows:movements}=useRows("stock_movements",refreshKey);
  const stock=products.filter(p=>p.track_stock), low=stock.filter(p=>Number(p.quantity)<=Number(p.low_stock_level||0));
  const sales=invoices.filter(i=>i.created_at?.slice(0,10)===today()).reduce((s,i)=>s+Number(i.grand_total||0),0);
  const bills=invoices.filter(i=>i.created_at?.slice(0,10)===today()).length;
  const recent=invoices.slice(0,6);
  return <><div className="welcome-row"><div><h2>Good day 👋</h2><p>Here’s your shop’s activity at a glance.</p></div><button className="primary" onClick={()=>setPage("billing")}><Plus size={17}/> Create new bill</button></div>
    <div className="stats-grid"><Stat label="Catalog items" value={products.length} sub="Products & services" icon={Boxes}/><Stat label="Today's sales" value={money(sales)} sub={`${bills} bills today`} icon={BarChart3} accent="gold"/><Stat label="Low stock alerts" value={low.length} sub="Items need attention" icon={AlertTriangle} accent="warning"/><Stat label="Stock movements" value={movements.length} sub="Recorded entries" icon={ClipboardList}/></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-head"><div><h3>Low stock items</h3><p>Products at or below reorder level</p></div><button className="text-btn" onClick={()=>setPage("inventory")}>View stock</button></div>{low.length===0?<Empty text="No low-stock items. Your stock levels look good."/>:<div className="simple-list">{low.slice(0,7).map(p=><div className="simple-row" key={p.id}><div className="product-dot"><Package size={16}/></div><div className="grow"><b>{p.name}</b><small>{p.category}</small></div><span className="stock-low">{p.quantity} {p.unit}</span></div>)}</div>}</section>
    <section className="panel"><div className="panel-head"><div><h3>Recent bills</h3><p>Latest sales from all devices</p></div><button className="text-btn" onClick={()=>setPage("reports")}>All reports</button></div>{recent.length===0?<Empty text="No bills created yet."/>:<div className="simple-list">{recent.map(i=><div className="simple-row" key={i.id}><div className="bill-icon"><ReceiptText size={16}/></div><div className="grow"><b>{i.invoice_no}</b><small>{i.customer_name||"Walk-in customer"}</small></div><strong>{money(i.grand_total)}</strong></div>)}</div>}</section></div>
  </>;
}

function Inventory({flash,profile,refreshKey}) {
  const {rows,reload}=useRows("products",refreshKey,"name");
  const [query,setQuery]=useState(""),[show,setShow]=useState(false);
  const [form,setForm]=useState({name:"",category:CATEGORIES[0],sku:"",unit:"pcs",quantity:0,selling_price:0,purchase_price:0,low_stock_level:5,track_stock:true});
  const filtered=rows.filter(p=>(p.name+" "+p.category+" "+(p.sku||"")).toLowerCase().includes(query.toLowerCase()));
  const save=async e=>{e.preventDefault();const payload={...form,quantity:Number(form.quantity),selling_price:Number(form.selling_price),purchase_price:Number(form.purchase_price),low_stock_level:Number(form.low_stock_level),track_stock:form.category==="Xerox / Printing services"?false:form.track_stock};const {error}=await supabase.from("products").insert(payload);if(error)flash(error.message);else{flash("Item added to stock register.");setShow(false);setForm({...form,name:"",sku:"",quantity:0});reload();}};
  const adjust=async p=>{const raw=prompt(`Enter new physical stock quantity for ${p.name}:`,p.quantity);if(raw===null||raw.trim()===""||!Number.isFinite(Number(raw))||Number(raw)<0)return;const {error}=await supabase.rpc("adjust_stock",{p_product_id:p.id,p_new_quantity:Number(raw),p_note:"Manual stock count adjustment"});if(error)flash(error.message);else{flash("Stock adjusted and movement recorded.");reload();}};
  return <><div className="page-tools"><div className="searchbox"><Search size={17}/><input placeholder="Search item, category or SKU…" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="primary" onClick={()=>setShow(!show)}><Plus size={17}/> Add item</button></div>
    {show&&<form className="panel form-panel" onSubmit={save}><div className="panel-head"><div><h3>Add inventory item</h3><p>Add a product or a billable service</p></div><button type="button" className="icon-btn" onClick={()=>setShow(false)}><X/></button></div><div className="form-grid"><Field label="Item / service name"><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field><Field label="Category"><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{CATEGORIES.map(c=><option>{c}</option>)}</select></Field><Field label="SKU / code"><input value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})}/></Field><Field label="Unit"><input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="pcs, ream, sheet"/></Field><Field label="Opening quantity"><input type="number" min="0" step="0.01" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></Field><Field label="Selling price (₹)"><input type="number" min="0" step="0.01" value={form.selling_price} onChange={e=>setForm({...form,selling_price:e.target.value})}/></Field><Field label="Purchase cost (₹)"><input type="number" min="0" step="0.01" value={form.purchase_price} onChange={e=>setForm({...form,purchase_price:e.target.value})}/></Field><Field label="Low stock alert at"><input type="number" min="0" value={form.low_stock_level} onChange={e=>setForm({...form,low_stock_level:e.target.value})}/></Field></div><div className="form-actions"><button className="primary">Save item</button></div></form>}
    <div className="panel table-panel"><div className="panel-head"><div><h3>Stock register</h3><p>{filtered.length} items in catalogue</p></div><span className="soft-pill">Live data</span></div><div className="table-scroll"><table><thead><tr><th>Item</th><th>Category</th><th>SKU</th><th>Quantity</th><th>Buy price</th><th>Sell price</th><th>Profit / unit</th><th>Stock profit</th><th>Stock status</th><th>Action</th></tr></thead><tbody>{filtered.map(p=><tr key={p.id}><td><b>{p.name}</b><small className="cell-sub">{p.unit}</small></td><td>{p.category}</td><td>{p.sku||"—"}</td><td><b>{p.track_stock?p.quantity:"—"}</b></td><td>{money(p.purchase_price)}</td><td>{money(p.selling_price)}</td><td><b className={Number(p.selling_price)-Number(p.purchase_price)>=0?"profit-positive":"profit-negative"}>{money(Number(p.selling_price)-Number(p.purchase_price))}</b></td><td>{p.track_stock?money((Number(p.selling_price)-Number(p.purchase_price))*Number(p.quantity)): "—"}</td><td>{!p.track_stock?<span className="soft-pill">Service</span>:Number(p.quantity)<=Number(p.low_stock_level)?<span className="status danger">Low stock</span>:<span className="status good">In stock</span>}</td><td>{p.track_stock&&<button className="small-btn" onClick={()=>adjust(p)}>Adjust</button>}</td></tr>)}</tbody></table>{filtered.length===0&&<Empty text="No items found. Add your first product above."/>}</div></div>
  </>;
}

function Billing({flash,profile,refreshKey}) {
  const {rows:products}=useRows("products",refreshKey,"name");
  const [cart,setCart]=useState([]),[customer,setCustomer]=useState(""),[phone,setPhone]=useState(""),[payment,setPayment]=useState("cash"),[discount,setDiscount]=useState(0),[busy,setBusy]=useState(false);
  const add=p=>{setCart(old=>{const found=old.find(x=>x.product_id===p.id);return found?old.map(x=>x.product_id===p.id?{...x,quantity:Number(x.quantity)+1}:x):[...old,{product_id:p.id,name:p.name,quantity:1,unit_price:Number(p.selling_price),track_stock:p.track_stock,available:Number(p.quantity),unit:p.unit}]})};
  const update=(id,key,val)=>setCart(old=>old.map(x=>x.product_id===id?{...x,[key]:val}:x));
  const subtotal=cart.reduce((s,x)=>s+Number(x.quantity||0)*Number(x.unit_price||0),0), total=Math.max(0,subtotal-Number(discount||0));
  const save=async()=>{if(!cart.length)return flash("Add at least one item.");if(cart.some(x=>Number(x.quantity)<=0||Number(x.unit_price)<0))return flash("Check item quantities and prices.");setBusy(true);
    const {data,error}=await supabase.rpc("create_invoice",{p_customer_name:customer||"Walk-in customer",p_customer_phone:phone||null,p_payment_method:payment,p_discount:Number(discount||0),p_items:cart.map(x=>({product_id:x.product_id,quantity:Number(x.quantity),unit_price:Number(x.unit_price)}))});
    setBusy(false);if(error)flash(error.message);else{flash(`Bill ${data.invoice_no} saved. Stock updated on all devices.`);setCart([]);setCustomer("");setPhone("");setDiscount(0);}
  };
  const available=products.filter(p=>!p.track_stock||Number(p.quantity)>0);
  return <div className="billing-layout"><section className="panel catalog-panel"><div className="panel-head"><div><h3>Choose items</h3><p>Products and printing services</p></div><span className="soft-pill">{available.length} available</span></div><div className="catalog-grid">{available.map(p=><button className="catalog-item" key={p.id} onClick={()=>add(p)}><span className="catalog-plus"><Plus size={16}/></span><b>{p.name}</b><small>{p.category}</small><strong>{money(p.selling_price)}</strong>{p.track_stock&&<em>{p.quantity} {p.unit} left</em>}</button>)}</div>{available.length===0&&<Empty text="Add products and services in Stock Register first."/>}</section>
    <section className="panel checkout-panel"><div className="panel-head"><div><h3>Current bill</h3><p>Items added to this invoice</p></div><span className="bill-badge"><ReceiptText size={15}/> New bill</span></div><div className="customer-fields"><Field label="Customer name"><input value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Walk-in customer"/></Field><Field label="Phone number"><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Optional"/></Field></div>
    <div className="cart-list">{cart.map(x=><div className="cart-row" key={x.product_id}><div className="grow"><b>{x.name}</b><small>{money(x.unit_price)} / {x.unit}</small></div><input className="qty-input" type="number" min="0.01" step="0.01" value={x.quantity} onChange={e=>update(x.product_id,"quantity",e.target.value)}/><strong>{money(Number(x.quantity)*Number(x.unit_price))}</strong><button className="remove-btn" onClick={()=>setCart(c=>c.filter(i=>i.product_id!==x.product_id))}><Trash2 size={15}/></button></div>)}{cart.length===0&&<Empty text="Select products or services to start a bill."/>}</div>
    <div className="checkout-bottom"><Field label="Payment method"><select value={payment} onChange={e=>setPayment(e.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="credit">Credit</option></select></Field><Field label="Discount (₹)"><input type="number" min="0" max={subtotal} step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)}/></Field><div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Discount</span><b>− {money(discount)}</b></div><div className="grand"><span>Grand total</span><strong>{money(total)}</strong></div></div><button className="primary full" disabled={!cart.length||busy} onClick={save}>{busy?"Saving bill…":`Save bill · ${money(total)}`}</button><p className="tiny muted">Stock is deducted atomically when the bill is saved. If stock is insufficient, the bill is rejected.</p></div></section>
  </div>;
}

function Purchases({flash,profile}) {
  const {rows:products,reload}=useRows("products",0,"name");
  const [product,setProduct]=useState(""),[qty,setQty]=useState(""),[cost,setCost]=useState(""),[supplier,setSupplier]=useState(""),[busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();setBusy(true);const {error}=await supabase.rpc("receive_stock",{p_product_id:product,p_quantity:Number(qty),p_unit_cost:Number(cost||0),p_supplier:supplier||null});setBusy(false);if(error)flash(error.message);else{flash("Purchase received. Stock increased.");setQty("");setCost("");setSupplier("");reload();}};
  return <div className="narrow"><div className="panel form-panel"><div className="panel-head"><div><h3>Record a purchase</h3><p>Received stock is added to the shared inventory.</p></div><div className="stat-icon gold"><ShoppingCart/></div></div><form onSubmit={submit} className="stack-form"><Field label="Select product"><select required value={product} onChange={e=>setProduct(e.target.value)}><option value="">Choose product</option>{products.filter(p=>p.track_stock).map(p=><option value={p.id}>{p.name} · Current: {p.quantity} {p.unit}</option>)}</select></Field><div className="form-grid"><Field label="Quantity received"><input required type="number" min="0.01" step="0.01" value={qty} onChange={e=>setQty(e.target.value)}/></Field><Field label="Unit purchase cost (₹)"><input type="number" min="0" step="0.01" value={cost} onChange={e=>setCost(e.target.value)}/></Field></div><Field label="Supplier / vendor"><input value={supplier} onChange={e=>setSupplier(e.target.value)} placeholder="Optional supplier name"/></Field><button className="primary" disabled={busy||!product}>{busy?"Saving…":"Save purchase entry"}</button></form></div></div>;
}

function Customers({flash}) {
  const {rows}=useRows("customers");
  const [name,setName]=useState(""),[phone,setPhone]=useState("");
  const save=async e=>{e.preventDefault();const {error}=await supabase.from("customers").insert({name,phone:phone||null});if(error)flash(error.message);else{flash("Customer added.");setName("");setPhone("");}};
  return <><div className="panel form-panel"><div className="panel-head"><div><h3>Add customer</h3><p>Keep customer details for future bills.</p></div></div><form className="inline-form" onSubmit={save}><Field label="Customer name"><input required value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Phone number"><input value={phone} onChange={e=>setPhone(e.target.value)}/></Field><button className="primary">Add customer</button></form></div><div className="panel table-panel"><div className="panel-head"><h3>Customer list</h3><span className="soft-pill">{rows.length} customers</span></div><div className="table-scroll"><table><thead><tr><th>Name</th><th>Phone</th><th>Added</th></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><b>{c.name}</b></td><td>{c.phone||"—"}</td><td>{new Date(c.created_at).toLocaleDateString("en-IN")}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No customers saved yet."/ >}</div></div></>;
}

function Reports({refreshKey}) {
  const {rows}=useRows("invoices",refreshKey);
  const total=rows.reduce((s,x)=>s+Number(x.grand_total||0),0);
  const day=rows.filter(x=>x.created_at?.slice(0,10)===today());
  return <><div className="stats-grid"><Stat label="Total bills" value={rows.length} icon={ReceiptText}/><Stat label="Total sales" value={money(total)} icon={BarChart3} accent="gold"/><Stat label="Today's bills" value={day.length} icon={ClipboardList}/><Stat label="Today's sales" value={money(day.reduce((s,x)=>s+Number(x.grand_total||0),0))} icon={ShoppingCart}/></div><div className="panel table-panel"><div className="panel-head"><div><h3>Sales register</h3><p>Invoices created by owner and staff</p></div></div><div className="table-scroll"><table><thead><tr><th>Bill no.</th><th>Date</th><th>Customer</th><th>Payment</th><th>Total</th></tr></thead><tbody>{rows.map(i=><tr key={i.id}><td><b>{i.invoice_no}</b></td><td>{new Date(i.created_at).toLocaleString("en-IN")}</td><td>{i.customer_name}</td><td><span className="soft-pill">{i.payment_method}</span></td><td><b>{money(i.grand_total)}</b></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No sales recorded yet."/ >}</div></div></>;
}

function Staff({flash,profile}) {
  const [email,setEmail]=useState(""),[busy,setBusy]=useState(false);
  const invite=async e=>{e.preventDefault();setBusy(true);const {data:{session}}=await supabase.auth.getSession();const {data,error}=await supabase.functions.invoke("invite-staff",{body:{email},headers:{Authorization:`Bearer ${session.access_token}`}});setBusy(false);if(error)flash(error.message);else{flash(data?.message||"Staff invitation sent.");setEmail("");}};
  return <div className="narrow"><div className="panel form-panel"><div className="panel-head"><div><h3>Invite a staff member</h3><p>Send an email invitation for a separate staff login.</p></div><div className="stat-icon"><Users/></div></div><form className="stack-form" onSubmit={invite}><Field label="Staff email address"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="staff@example.com"/></Field><div className="info-box"><ShieldCheck size={18}/><span>Staff can create bills, view stock and record purchases. Only the owner can invite staff.</span></div><button className="primary" disabled={busy}>{busy?"Sending invitation…":"Invite staff"}</button></form></div></div>;
}

function SettingsPage({shop,profile,flash}) {
  const [name,setName]=useState(shop.name||"AL-BUHARI XEROX & STATIONERY");
  const save=async e=>{e.preventDefault();const {error}=await supabase.from("shops").update({name}).eq("id",shop.id);flash(error?error.message:"Shop name updated. Refresh to see the change.");};
  return <div className="narrow"><div className="panel form-panel"><div className="panel-head"><div><h3>Shop settings</h3><p>Business and account information</p></div><div className="stat-icon gold"><Settings/></div></div><form className="stack-form" onSubmit={save}><Field label="Shop name"><input value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="Your role"><input value={profile.role} disabled/></Field><Field label="Login email"><input value={profile.email||""} disabled/></Field><button className="primary">Save shop details</button></form></div><div className="panel info-panel"><h3>Cloud synchronization</h3><p>All signed-in devices use the same Supabase database. Inventory, purchases and invoices update in real time when connected to the internet.</p><span className="live-dot">● Realtime enabled</span></div></div>;
}

function Empty({text}) { return <div className="empty"><Package size={25}/><p>{text}</p></div>; }

export default App;
