// Local preview only. AWS handles the deployed endpoint and sends real email.
export async function POST(request: Request) {
  if(request.headers.get('origin') !== new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
  const text=await request.text();
  if(text.length>16000)return Response.json({error:'Message too long.'},{status:413});
  try {
    const value: unknown=JSON.parse(text);
    if(!value || typeof value!=='object' || !('email' in value) || typeof value.email!=='string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email) || !('message' in value) || typeof value.message!=='string' || value.message.trim().length<10 || value.message.length>3000 || ('website' in value && value.website))return Response.json({error:'Check your email and message.'},{status:400});
    return Response.json({sent:true,testMode:true},{headers:{'Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Invalid request.'},{status:400}); }
}
