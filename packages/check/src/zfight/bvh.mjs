export function triangleBoxes(positions, count, inflate = 0) {
  const boxes = new Float32Array(count * 6)
  for (let t = 0; t < count; t++) {
    const o = t * 9
    for (let axis = 0; axis < 3; axis++) {
      const a = positions[o + axis]
      const b = positions[o + 3 + axis]
      const c = positions[o + 6 + axis]
      boxes[t * 6 + axis] = Math.min(a, b, c) - inflate
      boxes[t * 6 + 3 + axis] = Math.max(a, b, c) + inflate
    }
  }
  return boxes
}

export function buildBVH(boxes, count, leafSize = 6) {
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i
  const centres = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) centres[i * 3 + axis] = (boxes[i * 6 + axis] + boxes[i * 6 + 3 + axis]) / 2
  const capacity = Math.max(1, count * 2)
  const bounds = new Float32Array(capacity * 6)
  const left = new Int32Array(capacity).fill(-1)
  const right = new Int32Array(capacity).fill(-1)
  const first = new Int32Array(capacity)
  const size = new Int32Array(capacity)
  let nodes = 0
  const allocate = () => nodes++
  if (count === 0) return { order, bounds, left, right, first, size, nodes: 0, count }
  const stack = [[allocate(), 0, count]]
  while (stack.length) {
    const [node, start, end] = stack.pop()
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity, cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity
    for (let i = start; i < end; i++) {
      const t = order[i]
      const b = t * 6
      if (boxes[b] < minX) minX = boxes[b]
      if (boxes[b + 1] < minY) minY = boxes[b + 1]
      if (boxes[b + 2] < minZ) minZ = boxes[b + 2]
      if (boxes[b + 3] > maxX) maxX = boxes[b + 3]
      if (boxes[b + 4] > maxY) maxY = boxes[b + 4]
      if (boxes[b + 5] > maxZ) maxZ = boxes[b + 5]
      const c = t * 3
      if (centres[c] < cMinX) cMinX = centres[c]
      if (centres[c] > cMaxX) cMaxX = centres[c]
      if (centres[c + 1] < cMinY) cMinY = centres[c + 1]
      if (centres[c + 1] > cMaxY) cMaxY = centres[c + 1]
      if (centres[c + 2] < cMinZ) cMinZ = centres[c + 2]
      if (centres[c + 2] > cMaxZ) cMaxZ = centres[c + 2]
    }
    bounds[node * 6] = minX; bounds[node * 6 + 1] = minY; bounds[node * 6 + 2] = minZ
    bounds[node * 6 + 3] = maxX; bounds[node * 6 + 4] = maxY; bounds[node * 6 + 5] = maxZ
    const n = end - start
    if (n <= leafSize) { first[node] = start; size[node] = n; continue }
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
    const split = (axis === 0 ? cMinX + cMaxX : axis === 1 ? cMinY + cMaxY : cMinZ + cMaxZ) / 2
    let i = start
    let j = end - 1
    while (i <= j) {
      if (centres[order[i] * 3 + axis] < split) i++
      else { const swap = order[i]; order[i] = order[j]; order[j] = swap; j-- }
    }
    let mid = i
    if (mid === start || mid === end) {
      const slice = Array.from(order.subarray(start, end)).sort((a, b) => centres[a * 3 + axis] - centres[b * 3 + axis])
      order.set(slice, start)
      mid = start + (n >> 1)
    }
    const l = allocate()
    const r = allocate()
    left[node] = l
    right[node] = r
    stack.push([r, mid, end], [l, start, mid])
  }
  return { order, bounds, left, right, first, size, nodes, count }
}

export function queryBVH(bvh, minX, minY, minZ, maxX, maxY, maxZ, visit) {
  if (bvh.nodes === 0) return
  const { bounds, left, right, first, size, order } = bvh
  const stack = [0]
  while (stack.length) {
    const node = stack.pop()
    const b = node * 6
    if (bounds[b] > maxX || bounds[b + 3] < minX || bounds[b + 1] > maxY || bounds[b + 4] < minY || bounds[b + 2] > maxZ || bounds[b + 5] < minZ) continue
    if (left[node] < 0) {
      const end = first[node] + size[node]
      for (let i = first[node]; i < end; i++) visit(order[i])
    } else stack.push(left[node], right[node])
  }
}
