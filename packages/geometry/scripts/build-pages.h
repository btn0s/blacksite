uint32_t floatWord(float value) {
  uint32_t word;
  std::memcpy(&word, &value, 4);
  return word;
}
uint32_t align16(uint32_t value) { return (value + 15) & ~15u; }
struct Page {
  uint32_t minDepth, maxDepth, pinned;
  std::vector<uint32_t> groups, vertices;
  std::unordered_map<uint32_t, uint32_t> remap;
  uint32_t references = 0, indices = 0, clusters = 0;
};
struct PackingGroup {
  std::vector<uint32_t> vertices;
  uint32_t references = 0, indices = 0, depth = 0, pinned = 0;
};
uint32_t pageSize(uint32_t vertices, uint32_t references, uint32_t indices, uint32_t clusters, uint32_t stride) {
  return align16(align16(align16(64 + vertices * stride) + references * 4) + indices) + clusters * 160;
}
std::vector<unsigned char> encodeVertexStream(const void* data, size_t count, size_t stride) {
  std::vector<unsigned char> encoded(meshopt_encodeVertexBufferBound(count, stride)), decoded(count * stride);
  size_t size = meshopt_encodeVertexBufferLevel(encoded.data(), encoded.size(), data, count, stride, 2, 0);
  if (!size || meshopt_decodeVertexBuffer(decoded.data(), count, stride, encoded.data(), size) || std::memcmp(decoded.data(), data, decoded.size()))
    throw std::runtime_error("Vertex codec roundtrip failed");
  encoded.resize(size);
  return encoded;
}
std::vector<unsigned char> encodeReferenceStream(const uint32_t* data, size_t count, size_t vertices) {
  std::vector<unsigned char> encoded(meshopt_encodeIndexSequenceBound(count, vertices));
  std::vector<uint32_t> decoded(count);
  size_t size = meshopt_encodeIndexSequence(encoded.data(), encoded.size(), data, count);
  if (!size || meshopt_decodeIndexSequence(decoded.data(), count, 4, encoded.data(), size) || std::memcmp(decoded.data(), data, count * 4))
    throw std::runtime_error("Reference codec roundtrip failed");
  encoded.resize(size);
  return encoded;
}
std::vector<unsigned char> encodeTriangleStream(std::vector<uint32_t>& triangles) {
  std::vector<unsigned char> encoded(meshopt_encodeIndexBufferBound(triangles.size(), 128));
  std::vector<uint32_t> decoded(triangles.size());
  size_t size = meshopt_encodeIndexBuffer(encoded.data(), encoded.size(), triangles.data(), triangles.size());
  if (!size || meshopt_decodeIndexBuffer(decoded.data(), decoded.size(), 4, encoded.data(), size)) throw std::runtime_error("Triangle codec decode failed");
  for (size_t i = 0; i < triangles.size(); i += 3) {
    bool valid = false;
    for (size_t rotation = 0; rotation < 3; rotation++)
      valid |= decoded[i] == triangles[i + rotation] && decoded[i + 1] == triangles[i + (rotation + 1) % 3] && decoded[i + 2] == triangles[i + (rotation + 2) % 3];
    if (!valid) throw std::runtime_error("Triangle codec changed topology or winding");
  }
  triangles.swap(decoded); encoded.resize(size);
  return encoded;
}
void writePages(const char* directoryPath, const char* packPath, const Output& out,
  const std::vector<uint32_t>& vertices, const std::vector<uint32_t>& references, const std::vector<uint32_t>& indices,
  const std::vector<uint32_t>& clusterData, const std::vector<float>& clusterBounds, const std::vector<float>& clusterLod,
  const std::vector<float>& quantization, const std::vector<uint32_t>& groupChildren, const std::vector<uint32_t>& groupData,
  const std::vector<uint32_t>& nodeData, const std::vector<float>& nodeBounds, uint32_t levels, uint32_t vertexWords,
  uint32_t residentIndices, bool hasColor, bool hasUv1, bool hasTangent, const float* uv1Lower, const float* uv1Upper) {
  const uint32_t capacity = 128 * 1024, stride = vertexWords * 4;
  const float quantizationRadius = std::sqrt(quantization[4] * quantization[4] + quantization[5] * quantization[5] + quantization[6] * quantization[6]) * 0.5f;
  std::vector<std::vector<uint32_t>> parents(out.groups.size());
  for (uint32_t group = 0; group < out.groups.size(); group++)
    for (uint32_t i = 0; i < groupData[group * 4 + 3]; i++)
      parents[groupChildren[groupData[group * 4 + 2] + i]].push_back(group);
  std::vector<uint32_t> roots, childOffsets{0}, parentOffsets{0}, parentEdges;
  std::vector<PackingGroup> packing(out.groups.size());
  std::vector<uint32_t> vertexOffsets(vertices.size() / vertexWords + 1);
  uint32_t maxGroupClusters = 0, maxGroupBytes = 0, maxVertices = 0, maxTriangles = 0;
  for (uint32_t group = 0; group < out.groups.size(); group++) {
    bool terminal = out.groups[group].value.simplified.error == FLT_MAX;
    if (terminal != parents[group].empty()) throw std::runtime_error("Terminal group has inconsistent reverse dependencies");
    if (terminal) roots.push_back(group);
    PackingGroup& info = packing[group];
    info.depth = uint32_t(out.groups[group].value.depth); info.pinned = uint32_t(terminal);
    const Group& value = out.groups[group];
    if (value.count > 21) throw std::runtime_error("Group exceeds the pinned 21-cluster contract");
    for (uint32_t j = value.offset; j < value.offset + value.count; j++) {
      uint32_t count = clusterData[j * 8 + 6], triangles = clusterData[j * 8 + 1] / 3;
      if (count > 128 || triangles > 128) throw std::runtime_error("Cluster exceeds the pinned 128-vertex/triangle contract");
      maxVertices = std::max(maxVertices, count); maxTriangles = std::max(maxTriangles, triangles);
      info.references += count; info.indices += (clusterData[j * 8 + 1] + 3) / 4 * 4;
      info.vertices.insert(info.vertices.end(), references.begin() + clusterData[j * 8 + 7], references.begin() + clusterData[j * 8 + 7] + count);
    }
    std::sort(info.vertices.begin(), info.vertices.end());
    info.vertices.erase(std::unique(info.vertices.begin(), info.vertices.end()), info.vertices.end());
    for (uint32_t vertex : info.vertices) vertexOffsets[vertex + 1]++;
    uint32_t groupBytes = pageSize(uint32_t(info.vertices.size()), info.references, info.indices, value.count, stride);
    if (groupBytes > capacity) throw std::runtime_error("Whole group does not fit a physical page");
    maxGroupClusters = std::max(maxGroupClusters, value.count); maxGroupBytes = std::max(maxGroupBytes, groupBytes);
    childOffsets.push_back(childOffsets.back() + groupData[group * 4 + 3]);
    parentEdges.insert(parentEdges.end(), parents[group].begin(), parents[group].end());
    parentOffsets.push_back(uint32_t(parentEdges.size()));
  }
  for (size_t i = 1; i < vertexOffsets.size(); i++) vertexOffsets[i] += vertexOffsets[i - 1];
  std::vector<uint32_t> vertexGroups(vertexOffsets.back()), vertexCursor = vertexOffsets;
  for (uint32_t group = 0; group < packing.size(); group++) for (uint32_t vertex : packing[group].vertices) vertexGroups[vertexCursor[vertex]++] = group;
  std::vector<uint32_t> spatialRank(packing.size()), spatialOrder(packing.size()), seedOrder(packing.size());
  meshopt_spatialSortRemap(spatialRank.data(), out.groups[0].value.simplified.center, out.groups.size(), sizeof(Group));
  for (uint32_t i = 0; i < packing.size(); i++) { spatialOrder[spatialRank[i]] = i; seedOrder[i] = i; }
  std::sort(seedOrder.begin(), seedOrder.end(), [&](uint32_t a, uint32_t b) {
    if (packing[a].pinned != packing[b].pinned) return packing[a].pinned < packing[b].pinned;
    if (packing[a].depth != packing[b].depth) return packing[a].depth < packing[b].depth;
    return spatialRank[a] < spatialRank[b];
  });
  std::vector<unsigned char> assigned(packing.size());
  std::vector<uint32_t> owner(packing.size()), visited(packing.size());
  std::vector<std::vector<uint32_t>> components(packing.size());
  for (uint32_t i = 0; i < packing.size(); i++) { owner[i] = i; components[i].push_back(i); }
  uint32_t generation = 0;
  auto alternatePath = [&](uint32_t from, uint32_t to) {
    generation++;
    visited[from] = generation;
    std::vector<uint32_t> queue;
    for (uint32_t group : components[from]) for (uint32_t parent : parents[group]) {
      uint32_t node = owner[parent];
      if (node != from && node != to && visited[node] != generation) { visited[node] = generation; queue.push_back(node); }
    }
    for (size_t cursor = 0; cursor < queue.size(); cursor++) for (uint32_t group : components[queue[cursor]]) for (uint32_t parent : parents[group]) {
      uint32_t node = owner[parent];
      if (node == to) return true;
      if (visited[node] != generation) { visited[node] = generation; queue.push_back(node); }
    }
    return false;
  };
  std::vector<Page> pages;
  for (uint32_t seed : seedOrder) {
    if (assigned[seed]) continue;
    Page page{packing[seed].depth, packing[seed].depth, packing[seed].pinned, {}, {}, {}};
    std::unordered_map<uint32_t, uint32_t> shared;
    auto offer = [&](uint32_t id) { if (!assigned[id] && packing[id].pinned == page.pinned) shared.emplace(id, 0); };
    uint32_t chosen = seed;
    while (chosen != uint32_t(-1)) {
      const PackingGroup& info = packing[chosen];
      if (chosen != seed) { owner[chosen] = seed; components[seed].push_back(chosen); components[chosen].clear(); }
      assigned[chosen] = 1; shared.erase(chosen); page.groups.push_back(chosen);
      page.minDepth = std::min(page.minDepth, info.depth); page.maxDepth = std::max(page.maxDepth, info.depth);
      for (uint32_t vertex : info.vertices) if (!page.remap.count(vertex)) {
        page.remap[vertex] = uint32_t(page.vertices.size()); page.vertices.push_back(vertex);
        for (uint32_t edge = vertexOffsets[vertex]; edge < vertexOffsets[vertex + 1]; edge++) {
          uint32_t id = vertexGroups[edge];
          if (!assigned[id] && packing[id].pinned == page.pinned) shared[id]++;
        }
      }
      page.references += info.references; page.indices += info.indices; page.clusters += out.groups[chosen].count;
      for (uint32_t parent : parents[chosen]) {
        offer(parent);
        for (uint32_t i = groupData[parent * 4 + 2]; i < groupData[parent * 4 + 2] + groupData[parent * 4 + 3]; i++) offer(groupChildren[i]);
      }
      for (uint32_t i = groupData[chosen * 4 + 2]; i < groupData[chosen * 4 + 2] + groupData[chosen * 4 + 3]; i++) offer(groupChildren[i]);
      uint32_t rank = spatialRank[chosen];
      for (uint32_t i = rank > 24 ? rank - 24 : 0; i < std::min(uint32_t(spatialOrder.size()), rank + 25); i++) offer(spatialOrder[i]);
      chosen = uint32_t(-1);
      double bestScore = -1, bestDistance = DBL_MAX;
      for (const auto& candidate : shared) {
        uint32_t id = candidate.first; const PackingGroup& next = packing[id];
        if (std::max(page.maxDepth, next.depth) - std::min(page.minDepth, next.depth) > 1) continue;
        uint32_t added = uint32_t(next.vertices.size()) - candidate.second;
        uint32_t size = pageSize(uint32_t(page.vertices.size()) + added, page.references + next.references, page.indices + next.indices, page.clusters + out.groups[id].count, stride);
        if (size > capacity) continue;
        double score = double(candidate.second * stride) / std::max(1u, added * stride + next.references * 4 + next.indices + out.groups[id].count * 160);
        const float* a = out.groups[id].value.simplified.center; const float* b = out.groups[seed].value.simplified.center;
        double distance = double(a[0] - b[0]) * (a[0] - b[0]) + double(a[1] - b[1]) * (a[1] - b[1]) + double(a[2] - b[2]) * (a[2] - b[2]);
        if (score > bestScore || (score == bestScore && (distance < bestDistance || (distance == bestDistance && id < chosen)))) {
          if (alternatePath(seed, id) || alternatePath(id, seed)) continue;
          chosen = id; bestScore = score; bestDistance = distance;
        }
      }
    }
    pages.push_back(std::move(page));
  }
  std::vector<uint32_t> groups(out.groups.size() * 8), pageDirectory;
  uint64_t packBytes = 0, payloadBytes = 0, pageVertices = 0, rootWire = 0, rootPayload = 0, rootPages = 0, residentBytes = 0, pinnedResidentBytes = 0;
  uint64_t vertexWire = 0, referenceWire = 0, indexWire = 0, clusterWire = 0;
  uint64_t coarseClusters = 0, coarseTriangles = 0, coarseReferences = 0, coarseVertices = 0, padding = 0;
  std::ofstream pack(packPath, std::ios::binary);
  for (uint32_t pageId = 0; pageId < pages.size(); pageId++) {
    const Page& page = pages[pageId];
    uint32_t vertexOffset = 64, referenceOffset = align16(vertexOffset + uint32_t(page.vertices.size()) * stride);
    uint32_t indexOffset = align16(referenceOffset + page.references * 4), clusterOffset = align16(indexOffset + page.indices);
    uint32_t bytes = clusterOffset + page.clusters * 160;
    std::vector<uint32_t> words(bytes / 4);
    const uint32_t depthRange = page.minDepth | (page.maxDepth << 16);
    const uint32_t header[16] = {0x504d5342, 5, pageId, bytes, depthRange, page.pinned, uint32_t(page.vertices.size()), page.references,
      page.indices, page.clusters, vertexOffset, referenceOffset, indexOffset, clusterOffset, stride, uint32_t(page.groups.size())};
    std::copy(header, header + 16, words.begin());
    for (uint32_t i = 0; i < page.vertices.size(); i++)
      std::copy_n(vertices.data() + page.vertices[i] * vertexWords, vertexWords, words.data() + vertexOffset / 4 + i * vertexWords);
    uint32_t referenceCursor = referenceOffset / 4, indexCursor = indexOffset / 4, clusterCursor = 0;
    for (uint32_t groupId : page.groups) {
      const Group& group = out.groups[groupId];
      const clodBounds& bounds = group.value.simplified;
      uint32_t* record = groups.data() + groupId * 8;
      record[0] = floatWord(bounds.center[0]); record[1] = floatWord(bounds.center[1]); record[2] = floatWord(bounds.center[2]);
      record[3] = floatWord(bounds.radius + quantizationRadius); record[4] = floatWord(bounds.error);
      record[5] = pageId; record[6] = clusterCursor; record[7] = group.count;
      for (uint32_t j = group.offset; j < group.offset + group.count; j++, clusterCursor++) {
        const uint32_t* data = clusterData.data() + j * 8;
        uint32_t* cluster = words.data() + clusterOffset / 4 + clusterCursor * 40;
        for (uint32_t k = 0; k < 4; k++) cluster[k] = floatWord(clusterBounds[j * 4 + k]);
        for (uint32_t k = 0; k < 12; k++) cluster[k + 4] = floatWord(clusterLod[j * 12 + k]);
        cluster[14] = data[5]; cluster[15] = data[3]; cluster[16] = indexCursor * 4; cluster[17] = data[1];
        cluster[18] = data[4]; cluster[19] = referenceCursor;
        for (uint32_t k = 0; k < 12; k++) cluster[k + 20] = floatWord(quantization[j * 12 + k]);
        cluster[23] = hasTangent ? 4 : 0;
        cluster[32] = vertexOffset / 4; cluster[33] = vertexWords; cluster[34] = hasColor ? 4 + uint32_t(hasTangent) : 0; cluster[35] = hasUv1 ? 4 + uint32_t(hasTangent) + uint32_t(hasColor) : 0;
        for (uint32_t k = 0; k < 2; k++) { cluster[36 + k] = floatWord(uv1Lower[k]); cluster[38 + k] = floatWord(uv1Upper[k] - uv1Lower[k]); }
        float radius = std::sqrt(quantization[j * 12 + 4] * quantization[j * 12 + 4] + quantization[j * 12 + 5] * quantization[j * 12 + 5] + quantization[j * 12 + 6] * quantization[j * 12 + 6]) * 0.5f;
        for (uint32_t k : {3u, 7u, 11u}) { float value; std::memcpy(&value, cluster + k, 4); cluster[k] = floatWord(value + radius); }
        for (uint32_t k = 0; k < data[6]; k++) words[referenceCursor++] = page.remap.at(references[data[7] + k]);
        uint32_t count = (data[1] + 3) / 4;
        std::copy_n(indices.data() + data[0] / 4, count, words.data() + indexCursor);
        indexCursor += count;
        if (page.pinned) { coarseClusters++; coarseTriangles += data[1] / 3; coarseReferences += data[6]; }
      }
    }
    if (referenceCursor != referenceOffset / 4 + page.references || indexCursor != indexOffset / 4 + page.indices / 4 || clusterCursor != page.clusters)
      throw std::runtime_error("Page section accounting mismatch");
    std::vector<uint32_t> triangles;
    const unsigned char* raw = reinterpret_cast<const unsigned char*>(words.data());
    for (uint32_t i = 0; i < page.clusters; i++) {
      const uint32_t* cluster = words.data() + clusterOffset / 4 + i * 40;
      for (uint32_t j = 0; j < cluster[17]; j++) triangles.push_back(raw[cluster[16] + j]);
    }
    auto encodedVertices = encodeVertexStream(words.data() + vertexOffset / 4, page.vertices.size(), stride);
    auto encodedReferences = encodeReferenceStream(words.data() + referenceOffset / 4, page.references, page.vertices.size());
    auto encodedIndices = encodeTriangleStream(triangles);
    auto encodedClusters = encodeVertexStream(words.data() + clusterOffset / 4, page.clusters, 160);
    uint32_t wireBytes = uint32_t(96 + encodedVertices.size() + encodedReferences.size() + encodedIndices.size() + encodedClusters.size());
    write(pack, std::vector<uint32_t>{0x574d5342, 5, pageId, wireBytes, bytes, uint32_t(page.vertices.size()), stride, page.references,
      page.indices, page.clusters, depthRange, page.pinned, uint32_t(page.groups.size()), uint32_t(triangles.size()),
      uint32_t(encodedVertices.size()), uint32_t(encodedReferences.size()), uint32_t(encodedIndices.size()), uint32_t(encodedClusters.size()), 0, 0, 0, 0, 0, 0});
    write(pack, encodedVertices); write(pack, encodedReferences); write(pack, encodedIndices); write(pack, encodedClusters);
    pageDirectory.insert(pageDirectory.end(), {uint32_t(packBytes), uint32_t(packBytes >> 32), wireBytes, page.pinned});
    uint64_t payload = page.vertices.size() * stride + page.references * 4 + page.indices + page.clusters * 160;
    packBytes += wireBytes; residentBytes += bytes; payloadBytes += payload; pageVertices += page.vertices.size(); padding += bytes - 64 - payload;
    vertexWire += encodedVertices.size(); referenceWire += encodedReferences.size(); indexWire += encodedIndices.size(); clusterWire += encodedClusters.size();
    if (page.pinned) { rootPages++; rootWire += wireBytes; pinnedResidentBytes += bytes; rootPayload += payload; coarseVertices += page.vertices.size(); }
  }
  std::ofstream directory(directoryPath, std::ios::binary);
  write(directory, std::vector<uint64_t>{0x50475342, 5, out.clusters.size(), out.groups.size(), indices.size(), groupChildren.size(), levels,
    vertices.size() / vertexWords, residentIndices, references.size(), nodeData.size() / 4, vertexWords, pages.size(), roots.size(),
    pageVertices, references.size() * 4, indices.size() * 4, maxGroupClusters, maxGroupBytes, coarseClusters, coarseTriangles,
    coarseReferences, coarseVertices, rootPayload, rootPages, rootWire, packBytes, payloadBytes,
    vertices.size() * 4 + references.size() * 4 + indices.size() * 4 + out.clusters.size() * 160, padding, maxVertices, maxTriangles,
    residentBytes, pinnedResidentBytes, hasTangent ? 4u : 0u, hasColor ? 4u + uint32_t(hasTangent) : 0u,
    hasUv1 ? 4u + uint32_t(hasTangent) + uint32_t(hasColor) : 0u, vertexWire, referenceWire, indexWire, clusterWire});
  write(directory, groups); write(directory, childOffsets); write(directory, groupChildren); write(directory, parentOffsets); write(directory, parentEdges);
  std::vector<float> conservativeNodeBounds = nodeBounds;
  for (size_t i = 0; i < conservativeNodeBounds.size(); i += 8) conservativeNodeBounds[i + 3] += quantizationRadius;
  write(directory, nodeData); write(directory, conservativeNodeBounds); write(directory, pageDirectory); write(directory, roots);
  std::cout << "Packed " << pages.size() << " pages; " << rootPages << " pinned; " << packBytes << " wire bytes\n";
}
