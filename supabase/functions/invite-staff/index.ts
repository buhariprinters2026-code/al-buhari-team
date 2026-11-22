import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await userClient.from("profiles").select("shop_id,role").eq("id", user.id).single();
  if (!profile || profile.role !== "owner") return Response.json({ error: "Only the owner can invite staff." }, { status: 403 });

  const body = await req.json();
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return Response.json({ error: "Email is required." }, { status: 400 });

  const admin = createClient(url, service);
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { shop_id: profile.shop_id, role: "staff", full_name: email.split("@")[0] }
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ message: `Invitation sent to ${email}.` });
});
