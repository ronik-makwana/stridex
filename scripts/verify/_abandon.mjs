/** Fails abandoned razorpay attempts through the real signed webhook, so the
 *  stock hold is released rather than orphaned. Test helper only. */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
const env=Object.fromEntries(readFileSync(new URL('../../apps/api/.env',import.meta.url),'utf8').split('\n').filter(l=>l&&!l.trimStart().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}))
for (const row of process.argv.slice(2)) {
  const [orderId,paise]=row.split(':')
  const body=JSON.stringify({entity:'event',event:'payment.failed',payload:{payment:{entity:{
    id:'pay_ABANDON'+Date.now(),amount:Number(paise),currency:'INR',status:'failed',
    order_id:orderId,error_description:'Abandoned test attempt'}}}})
  const r=await fetch('http://localhost:4000/api/webhooks/payments/razorpay',{method:'POST',
    headers:{'content-type':'application/json','X-Razorpay-Signature':createHmac('sha256',env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex')},body})
  console.log('released',orderId,await r.text())
}
