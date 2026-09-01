#!/usr/bin/env node
// Phase 13 API: facets, compound filters, the sort allow-list, category subtree.
// Read-only.
//   node scripts/verify/phase-13-api.mjs
const API='http://localhost:4000/api/storefront'
const get=async(p)=>(await fetch(`${API}${p}`)).json()

const f0=await get('/products/facets')
console.log('unfiltered facets:')
for(const f of f0.data.facets) console.log(`  ${f.name.padEnd(16)} ${f.values.map(v=>`${v.label}(${v.count})`).join(' ')}`)
console.log('  price:',JSON.stringify(f0.data.price))

const um=f0.data.facets.find(f=>f.name==='Upper Material')
const mesh=um.values.find(v=>v.label==='Mesh')
const brandFacet=f0.data.facets.find(f=>f.name==='Brand')
const nikeish=brandFacet.values.find(v=>/nike|adidas/i.test(v.label)) ?? brandFacet.values[0]

console.log(`\ncompound: ${um.name}=${mesh.label} AND Brand=${nikeish.label}`)
const q=`attr:${um.id}=${mesh.id}&brand=${nikeish.id}`
const grid=await get(`/products?${q}&limit=1`)
const fac=await get(`/products/facets?${q}`)
const meshCount=fac.data.facets.find(f=>f.name==='Upper Material').values.find(v=>v.id===mesh.id).count
const brandCount=fac.data.facets.find(f=>f.name==='Brand').values.find(v=>v.id===nikeish.id).count
console.log(`  grid total            ${grid.meta.total}`)
console.log(`  Mesh facet count      ${meshCount}   ${meshCount===grid.meta.total?'MATCH':'MISMATCH'}`)
console.log(`  ${nikeish.label} facet count  ${brandCount}   ${brandCount===grid.meta.total?'MATCH':'MISMATCH'}`)
console.log('  (each facet counts itself excluded, so both equal the grid)')

console.log('\nsort allow-list:')
for(const s of ['featured','newest','price_asc','price_desc','name_asc','pirce_asc','']){
  const r=await fetch(`${API}/products?limit=2&sort=${s}`)
  const j=await r.json()
  const first=j.data?.[0]
  console.log(`  sort=${(s||'(empty)').padEnd(11)} HTTP ${r.status}  ${first?`${first.price.padStart(8)}  ${first.title.slice(0,34)}`:j.error?.code??''}`)
}

console.log('\nprice sort actually orders by cheapest variant:')
for(const s of ['price_asc','price_desc']){
  const j=await get(`/products?limit=4&sort=${s}`)
  console.log(`  ${s}: ${j.data.map(p=>p.price).join(', ')}`)
}

console.log('\ncategory subtree:')
for(const c of ['men','women','kids','sneakers']){
  const j=await get(`/products?category=${c}&limit=1`)
  console.log(`  ${c.padEnd(9)} ${String(j.meta?.total ?? j.error?.code).padStart(4)}`)
}
console.log(`  unknown  ${(await fetch(`${API}/products?category=nope-nope`)).status}`)
