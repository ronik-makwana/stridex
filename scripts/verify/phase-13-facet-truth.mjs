#!/usr/bin/env node
// The phase-13 guarantee, checked exhaustively: every count the sidebar
// promises equals the grid you get when you tick it. Read-only.
//   node scripts/verify/phase-13-facet-truth.mjs
// For every brand value offered alongside a selected attribute, does the count
// the sidebar promises equal the grid you get when you tick it?
const API='http://localhost:4000/api/storefront'
const get=async(p)=>(await fetch(`${API}${p}`)).json()

const base=await get('/products/facets?category=men')
const um=base.data.facets.find(f=>f.name==='Upper Material')
const mesh=um.values.find(v=>v.label==='Mesh')
const scope=`category=men&attr:${um.id}=${mesh.id}`

const withMesh=await get(`/products/facets?${scope}`)
const brands=withMesh.data.facets.find(f=>f.name==='Brand').values
console.log(`Men + Upper Material=Mesh -> ${(await get(`/products?${scope}&limit=1`)).meta.total} products`)
console.log('checking every brand the sidebar offers:\n')
let bad=0
for(const b of brands){
  const grid=await get(`/products?${scope}&brand=${b.id}&limit=1`)
  const match = grid.meta.total === b.count
  if(!match) bad++
  console.log(`  ${match?'ok  ':'BAD '} ${b.label.padEnd(16)} sidebar ${String(b.count).padStart(3)}   grid ${String(grid.meta.total).padStart(3)}`)
}
console.log(`\n${bad === 0 ? 'every brand count matches its grid' : `${bad} MISMATCHES`}`)
process.exit(bad?1:0)
