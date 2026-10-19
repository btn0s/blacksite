#include <cassert>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include "meshoptimizer.h"
#define CLUSTERLOD_IMPLEMENTATION
#include "clusterlod.h"

struct Vertex { float position[3]; float normal[3]; float uv[2]; };
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
    if (argc != 3) throw std::runtime_error("Expected input and output paths");
    std::ifstream input(argv[1], std::ios::binary);
    uint32_t header[4];
    read(input, header, 4);
    if (header[0] != 0x49475342 || !header[1] || !header[2] || !header[3]) throw std::runtime_error("Invalid geometry input");
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
    const float weights[5] = {0.5f, 0.5f, 0.5f, 0.f, 0.f};
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
      mesh.attribute_count = 5;
      mesh.attribute_protect_mask = (1 << 3) | (1 << 4);
      clodBuild(config, mesh, &out, emitGroup);
    }
    std::vector<uint32_t> clusterData, groupData, groupChildren;
    std::vector<float> clusterBounds, clusterLod, groupBounds;
    uint32_t levels = 0;
    for (const Cluster& cluster : out.clusters) {
      clusterData.insert(clusterData.end(), {cluster.offset, cluster.count, cluster.group, cluster.refined, cluster.level, cluster.material, cluster.vertices, 0});
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
    std::ofstream output(argv[2], std::ios::binary);
    write(output, std::vector<uint32_t>{0x4f475342, uint32_t(out.clusters.size()), uint32_t(out.groups.size()), uint32_t(out.indices.size()), uint32_t(groupChildren.size()), levels, uint32_t(vertices.size()), uint32_t(indices.size())});
    write(output, vertices);
    write(output, indices);
    write(output, out.indices);
    write(output, clusterData);
    write(output, clusterBounds);
    write(output, clusterLod);
    write(output, groupData);
    write(output, groupBounds);
    write(output, groupChildren);
    std::cout << "Built " << out.clusters.size() << " clusters in " << out.groups.size() << " groups across " << levels << " levels\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
