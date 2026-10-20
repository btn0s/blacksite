#include <cassert>
#include <cstdint>
#include <cmath>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include "meshoptimizer.h"
#define CLUSTERLOD_IMPLEMENTATION
#include "clusterlod.h"

struct Vertex { float position[3]; float normal[3]; float uv[2]; float tangent[4]; float color[4]; float uv1[2]; };
struct Primitive { uint32_t offset; uint32_t count; uint32_t material; };
struct Cluster { uint32_t offset; uint32_t count; uint32_t group; uint32_t refined; uint32_t level; uint32_t material; uint32_t vertices; clodBounds bounds; };
struct Group { uint32_t offset; uint32_t count; clodGroup value; };
struct Output { std::vector<uint32_t> indices; std::vector<Cluster> clusters; std::vector<Group> groups; uint32_t material; };

template <typename T> void read(std::ifstream& stream, T* values, size_t count) {
  if (!stream.read(reinterpret_cast<char*>(values), sizeof(T) * count)) throw std::runtime_error("Truncated geometry input");
}
template <typename T> void write(std::ofstream& stream, const std::vector<T>& values) {
  if (!stream.write(reinterpret_cast<const char*>(values.data()), sizeof(T) * values.size())) throw std::runtime_error("Cannot write geometry output");
}
int emitGroup(void* context, clodGroup group, const clodCluster* clusters, size_t count) {
  Output& out = *static_cast<Output*>(context);
  uint32_t id = uint32_t(out.groups.size());
  out.groups.push_back({uint32_t(out.clusters.size()), uint32_t(count), group});
  for (size_t i = 0; i < count; i++) {
    const clodCluster& cluster = clusters[i];
    if (cluster.index_count > 384) throw std::runtime_error("Cluster exceeds 128 triangles");
    out.clusters.push_back({uint32_t(out.indices.size()), uint32_t(cluster.index_count), id, uint32_t(cluster.refined), uint32_t(group.depth), out.material, uint32_t(cluster.vertex_count), cluster.bounds});
    out.indices.insert(out.indices.end(), cluster.indices, cluster.indices + cluster.index_count);
  }
  return int(id);
}
void appendSphere(std::vector<float>& destination, const clodBounds& bounds) {
  destination.insert(destination.end(), {bounds.center[0], bounds.center[1], bounds.center[2], bounds.radius});
}
int main(int argc, char** argv) {
  try {
    if (argc != 4) throw std::runtime_error("Expected input, output and minimum resident error");
    const float minimumError = std::stof(argv[3]);
    if (!std::isfinite(minimumError) || minimumError < 0) throw std::runtime_error("Invalid minimum resident error");
    std::ifstream input(argv[1], std::ios::binary);
    uint32_t header[6];
    read(input, header, 6);
    if (header[0] != 0x49475342 || !header[1] || !header[2] || !header[3]) throw std::runtime_error("Invalid geometry input");
    if (header[4] > 1 || header[5] > 1) throw std::runtime_error("Invalid vertex layout");
    const bool hasColor = header[4] != 0, hasUv1 = header[5] != 0;
    const uint32_t vertexWords = 5 + header[4] + header[5];
    std::vector<Vertex> vertices(header[1]);
    std::vector<uint32_t> indices(header[2]);
    std::vector<Primitive> primitives(header[3]);
    read(input, vertices.data(), vertices.size());
    read(input, indices.data(), indices.size());
    read(input, primitives.data(), primitives.size());
    std::vector<unsigned int> vertexRemap(vertices.size());
    size_t uniqueVertices = meshopt_generateVertexRemap(vertexRemap.data(), indices.data(), indices.size(), vertices.data(), vertices.size(), sizeof(Vertex));
    meshopt_remapIndexBuffer(indices.data(), indices.data(), indices.size(), vertexRemap.data());
    meshopt_remapVertexBuffer(vertices.data(), vertices.data(), vertices.size(), sizeof(Vertex), vertexRemap.data());
    vertices.resize(uniqueVertices);
    std::cout << "Indexed " << header[1] << " source corners into " << uniqueVertices << " exact vertices\n";
    std::vector<unsigned int> remap(vertices.size());
    meshopt_generatePositionRemap(remap.data(), vertices[0].position, vertices.size(), sizeof(Vertex));
    std::vector<uint32_t> owners(vertices.size(), uint32_t(-1));
    std::vector<unsigned char> locks(vertices.size());
    for (size_t p = 0; p < primitives.size(); p++) {
      const Primitive& primitive = primitives[p];
      if (size_t(primitive.offset) + primitive.count > indices.size() || primitive.count % 3) throw std::runtime_error("Invalid primitive range");
      for (uint32_t i = 0; i < primitive.count; i++) {
        uint32_t vertex = indices[primitive.offset + i];
        if (vertex >= vertices.size()) throw std::runtime_error("Vertex index is out of range");
        uint32_t canonical = remap[vertex];
        if (owners[canonical] != uint32_t(-1) && owners[canonical] != p) locks[canonical] = meshopt_SimplifyVertex_Lock;
        owners[canonical] = uint32_t(p);
      }
    }
    for (size_t i = 0; i < locks.size(); i++) locks[i] = locks[remap[i]];
    Output out;
    auto config = clodDefaultConfig(128);
    config.min_triangles = 64;
    config.optimize_bounds = true;
    config.simplify_error_merge_additive = 1.f;
    config.simplify_fallback_sloppy = true;
    const float weights[15] = {0.5f, 0.5f, 0.5f, 0.f, 0.f, 0.f, 0.f, 0.f, 0.f, 1.f, 1.f, 1.f, 1.f, 0.f, 0.f};
    for (const Primitive& primitive : primitives) {
      if (size_t(primitive.offset) + primitive.count > indices.size() || primitive.count % 3) throw std::runtime_error("Invalid primitive range");
      out.material = primitive.material;
      clodMesh mesh = {};
      mesh.indices = indices.data() + primitive.offset;
      mesh.index_count = primitive.count;
      mesh.vertex_count = vertices.size();
      mesh.vertex_positions = vertices[0].position;
      mesh.vertex_positions_stride = sizeof(Vertex);
      mesh.vertex_attributes = vertices[0].normal;
      mesh.vertex_attributes_stride = sizeof(Vertex);
      mesh.vertex_lock = locks.data();
      mesh.attribute_weights = weights;
      mesh.attribute_count = hasUv1 ? 15 : hasColor ? 13 : 5;
      mesh.attribute_protect_mask = (1 << 3) | (1 << 4) | (hasUv1 ? (1 << 13) | (1 << 14) : 0);
      clodBuild(config, mesh, &out, emitGroup);
    }
    if (minimumError > 0) {
      Output resident;
      std::vector<uint32_t> groupRemap(out.groups.size(), uint32_t(-1));
      for (size_t i = 0; i < out.groups.size(); i++) {
        const Group& group = out.groups[i];
        if (group.value.simplified.error <= minimumError) continue;
        groupRemap[i] = uint32_t(resident.groups.size());
        resident.groups.push_back({uint32_t(resident.clusters.size()), group.count, group.value});
        for (uint32_t j = 0; j < group.count; j++) {
          Cluster cluster = out.clusters[group.offset + j];
          uint32_t oldOffset = cluster.offset;
          cluster.group = groupRemap[i];
          cluster.offset = uint32_t(resident.indices.size());
          resident.clusters.push_back(cluster);
          resident.indices.insert(resident.indices.end(), out.indices.begin() + oldOffset, out.indices.begin() + oldOffset + cluster.count);
        }
      }
      indices.clear();
      for (Cluster& cluster : resident.clusters) {
        if (cluster.refined != uint32_t(-1)) cluster.refined = groupRemap[cluster.refined];
        if (cluster.refined == uint32_t(-1)) indices.insert(indices.end(), resident.indices.begin() + cluster.offset, resident.indices.begin() + cluster.offset + cluster.count);
      }
      std::vector<unsigned int> compact(vertices.size());
      size_t count = meshopt_optimizeVertexFetchRemap(compact.data(), resident.indices.data(), resident.indices.size(), vertices.size());
      meshopt_remapIndexBuffer(resident.indices.data(), resident.indices.data(), resident.indices.size(), compact.data());
      meshopt_remapIndexBuffer(indices.data(), indices.data(), indices.size(), compact.data());
      meshopt_remapVertexBuffer(vertices.data(), vertices.data(), vertices.size(), sizeof(Vertex), compact.data());
      vertices.resize(count);
      out = std::move(resident);
    }
    std::vector<uint32_t> clusterData, groupData, groupChildren, packedVertices, packedIndices, vertexReferences;
    std::vector<float> clusterBounds, clusterLod, groupBounds, clusterQuantization;
    float lower[5] = {FLT_MAX, FLT_MAX, FLT_MAX, FLT_MAX, FLT_MAX};
    float upper[5] = {-FLT_MAX, -FLT_MAX, -FLT_MAX, -FLT_MAX, -FLT_MAX};
    for (const Vertex& vertex : vertices) for (int axis = 0; axis < 5; axis++) {
      float value = axis < 3 ? vertex.position[axis] : vertex.uv[axis - 3];
      lower[axis] = std::min(lower[axis], value);
      upper[axis] = std::max(upper[axis], value);
    }
    float step[5];
    for (int axis = 0; axis < 5; axis++) step[axis] = (upper[axis] - lower[axis]) / 65535.f;
    float uv1Lower[2] = {FLT_MAX, FLT_MAX}, uv1Upper[2] = {-FLT_MAX, -FLT_MAX};
    for (const Vertex& vertex : vertices) for (int axis = 0; axis < 2; axis++) {
      uv1Lower[axis] = std::min(uv1Lower[axis], vertex.uv1[axis]);
      uv1Upper[axis] = std::max(uv1Upper[axis], vertex.uv1[axis]);
    }
    for (const Vertex& vertex : vertices) {
      uint16_t quantized[5];
      for (int axis = 0; axis < 5; axis++) {
        float value = axis < 3 ? vertex.position[axis] : vertex.uv[axis - 3];
        quantized[axis] = uint16_t(meshopt_quantizeUnorm(upper[axis] > lower[axis] ? (value - lower[axis]) / (upper[axis] - lower[axis]) : 0.f, 16));
      }
      float normal[4] = {vertex.normal[0], vertex.normal[1], vertex.normal[2], 0.f};
      int16_t octNormal[4], octTangent[4];
      meshopt_encodeFilterOct(octNormal, 1, 8, 16, normal);
      meshopt_encodeFilterOct(octTangent, 1, 8, 16, vertex.tangent);
      packedVertices.insert(packedVertices.end(), {
        uint32_t(quantized[0]) | (uint32_t(quantized[1]) << 16),
        uint32_t(quantized[2]) | (uint32_t(uint16_t(octTangent[3])) << 16),
        uint32_t(uint16_t(octNormal[0])) | (uint32_t(uint16_t(octNormal[1])) << 16),
        uint32_t(quantized[3]) | (uint32_t(quantized[4]) << 16),
        uint32_t(uint16_t(octTangent[0])) | (uint32_t(uint16_t(octTangent[1])) << 16)
      });
      if (hasColor) {
        uint32_t color = 0;
        for (int channel = 0; channel < 4; channel++) color |= uint32_t(meshopt_quantizeUnorm(vertex.color[channel], 8)) << (channel * 8);
        packedVertices.push_back(color);
      }
      if (hasUv1) {
        uint32_t uv1 = 0;
        for (int axis = 0; axis < 2; axis++) uv1 |= uint32_t(meshopt_quantizeUnorm(uv1Upper[axis] > uv1Lower[axis] ? (vertex.uv1[axis] - uv1Lower[axis]) / (uv1Upper[axis] - uv1Lower[axis]) : 0.f, 16)) << (axis * 16);
        packedVertices.push_back(uv1);
      }
    }
    uint32_t levels = 0;
    for (const Cluster& cluster : out.clusters) {
      unsigned int localVertices[256];
      unsigned char localTriangles[384];
      size_t localCount = clodLocalIndices(localVertices, localTriangles, out.indices.data() + cluster.offset, cluster.count);
      uint32_t vertexOffset = uint32_t(vertexReferences.size());
      uint32_t indexOffset = uint32_t(packedIndices.size() * 4);
      vertexReferences.insert(vertexReferences.end(), localVertices, localVertices + localCount);
      for (uint32_t i = 0; i < cluster.count; i += 4) {
        uint32_t word = 0;
        for (uint32_t j = 0; j < 4 && i + j < cluster.count; j++) word |= uint32_t(localTriangles[i + j]) << (j * 8);
        packedIndices.push_back(word);
      }
      clusterData.insert(clusterData.end(), {indexOffset, cluster.count, cluster.group, cluster.refined, cluster.level, cluster.material, uint32_t(localCount), vertexOffset});
      clusterQuantization.insert(clusterQuantization.end(), {
        lower[0], lower[1], lower[2], 0.f,
        step[0], step[1], step[2], 0.f,
        lower[3], lower[4], upper[3] - lower[3], upper[4] - lower[4]
      });
      appendSphere(clusterBounds, cluster.bounds);
      const clodBounds& parent = out.groups[cluster.group].value.simplified;
      clodBounds self = cluster.bounds;
      self.error = 0.f;
      if (cluster.refined != uint32_t(-1)) self = out.groups[cluster.refined].value.simplified;
      if (self.error > parent.error) throw std::runtime_error("Nonmonotonic hierarchy error");
      appendSphere(clusterLod, self);
      appendSphere(clusterLod, parent);
      clusterLod.insert(clusterLod.end(), {self.error, parent.error, 0.f, 0.f});
      levels = std::max(levels, cluster.level + 1);
    }
    for (const Group& group : out.groups) {
      std::set<uint32_t> children;
      for (uint32_t i = 0; i < group.count; i++) {
        uint32_t refined = out.clusters[group.offset + i].refined;
        if (refined != uint32_t(-1)) children.insert(refined);
      }
      groupData.insert(groupData.end(), {group.offset, group.count, uint32_t(groupChildren.size()), uint32_t(children.size())});
      groupChildren.insert(groupChildren.end(), children.begin(), children.end());
      appendSphere(groupBounds, group.value.simplified);
      groupBounds.insert(groupBounds.end(), {group.value.simplified.error, float(group.value.depth), 0.f, 0.f});
    }
    std::vector<clodGroup> hierarchyGroups;
    for (const Group& group : out.groups) hierarchyGroups.push_back(group.value);
    std::vector<clodNode> nodes(clodBuildHierarchyBound(hierarchyGroups.size(), 8, levels));
    nodes.resize(clodBuildHierarchy(nodes.data(), hierarchyGroups.data(), hierarchyGroups.size(), 8, levels));
    std::vector<uint32_t> nodeData;
    std::vector<float> nodeBounds;
    for (const clodNode& node : nodes) {
      nodeData.insert(nodeData.end(), {uint32_t(node.group), node.child_offset, node.child_count, 0});
      appendSphere(nodeBounds, node.bounds);
      nodeBounds.insert(nodeBounds.end(), {node.bounds.error, 0.f, 0.f, 0.f});
    }
    std::ofstream output(argv[2], std::ios::binary);
    write(output, std::vector<uint32_t>{0x4f475342, uint32_t(out.clusters.size()), uint32_t(out.groups.size()), uint32_t(packedIndices.size()), uint32_t(groupChildren.size()), levels, uint32_t(packedVertices.size() / vertexWords), uint32_t(indices.size()), uint32_t(vertexReferences.size()), uint32_t(nodes.size()), vertexWords, 0});
    write(output, std::vector<float>{uv1Lower[0], uv1Lower[1], uv1Upper[0] - uv1Lower[0], uv1Upper[1] - uv1Lower[1]});
    write(output, packedVertices);
    write(output, vertexReferences);
    write(output, packedIndices);
    write(output, clusterData);
    write(output, clusterBounds);
    write(output, clusterLod);
    write(output, clusterQuantization);
    write(output, groupData);
    write(output, groupBounds);
    write(output, groupChildren);
    write(output, nodeData);
    write(output, nodeBounds);
    std::cout << "Built " << out.clusters.size() << " clusters in " << out.groups.size() << " groups across " << levels << " levels\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
