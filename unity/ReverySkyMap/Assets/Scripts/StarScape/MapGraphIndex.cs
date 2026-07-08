using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Read-only topology index for the current engine-built visual map.
/// It owns stable node and edge lookups plus adjacency caches for per-node reads.
/// </summary>
public sealed class MapGraphIndex
{
  private static readonly MapGraphNode[] EmptyNodes = Array.Empty<MapGraphNode>();
  private static readonly MapGraphEdge[] EmptyEdges = Array.Empty<MapGraphEdge>();
  private static readonly MapGraphNodeId[] EmptyNeighborIds = Array.Empty<MapGraphNodeId>();

  public static readonly MapGraphIndex Empty = new(
    EmptyNodes,
    EmptyEdges,
    new Dictionary<int, int>(),
    new Dictionary<string, int>(StringComparer.Ordinal),
    new Dictionary<int, int>(),
    Array.Empty<MapGraphNodeId[]>(),
    Array.Empty<MapGraphEdge[]>());

  private readonly MapGraphNode[] nodes;
  private readonly MapGraphEdge[] edges;
  private readonly Dictionary<int, int> nodeIndexByInstanceId;
  private readonly Dictionary<string, int> nodeIndexByNoteId;
  private readonly Dictionary<int, int> nodeIndexByTagId;
  private readonly MapGraphNodeId[][] neighborIdsByNodeIndex;
  private readonly MapGraphEdge[][] incidentEdgesByNodeIndex;

  private MapGraphIndex(
    MapGraphNode[] nodes,
    MapGraphEdge[] edges,
    Dictionary<int, int> nodeIndexByInstanceId,
    Dictionary<string, int> nodeIndexByNoteId,
    Dictionary<int, int> nodeIndexByTagId,
    MapGraphNodeId[][] neighborIdsByNodeIndex,
    MapGraphEdge[][] incidentEdgesByNodeIndex)
  {
    this.nodes = nodes;
    this.edges = edges;
    this.nodeIndexByInstanceId = nodeIndexByInstanceId;
    this.nodeIndexByNoteId = nodeIndexByNoteId;
    this.nodeIndexByTagId = nodeIndexByTagId;
    this.neighborIdsByNodeIndex = neighborIdsByNodeIndex;
    this.incidentEdgesByNodeIndex = incidentEdgesByNodeIndex;
  }

  /// <summary>
  /// Registered visual nodes. Positions stay live through each node's Transform reference.
  /// </summary>
  public IReadOnlyList<MapGraphNode> Nodes => nodes;

  /// <summary>
  /// Deduplicated visual edges between registered nodes only.
  /// </summary>
  public IReadOnlyList<MapGraphEdge> Edges => edges;

  /// <summary>
  /// Builds a topology index from the active engine's scene objects and the current runtime links.
  /// Duplicate note and tag ids collapse to one visual node, and adjacency is built once for the full graph.
  /// </summary>
  public static MapGraphIndex Build(
    IReadOnlyList<Star> stars,
    IReadOnlyList<TagNode> tagNodes,
    IReadOnlyList<MapRuntimeContext.RuntimeNoteLink> links)
  {
    int starCapacity = stars?.Count ?? 0;
    int tagCapacity = tagNodes?.Count ?? 0;
    int nodeCapacity = starCapacity + tagCapacity;
    int edgeCapacity = links?.Count ?? 0;

    var nodes = new List<MapGraphNode>(nodeCapacity);
    var edges = new List<MapGraphEdge>(edgeCapacity);
    var nodeIndexByInstanceId = new Dictionary<int, int>(nodeCapacity);
    var nodeIndexByNoteId = new Dictionary<string, int>(starCapacity, StringComparer.Ordinal);
    var nodeIndexByTagId = new Dictionary<int, int>(tagCapacity);
    var edgeKeys = new HashSet<EdgeKey>();

    RegisterStars(stars, nodes, nodeIndexByInstanceId, nodeIndexByNoteId);
    RegisterTagNodes(tagNodes, nodes, nodeIndexByInstanceId, nodeIndexByTagId);

    RegisterNoteNoteEdges(links, nodes, nodeIndexByNoteId, edgeKeys, edges);
    RegisterNoteTagEdges(nodes, nodeIndexByTagId, edgeKeys, edges);
    BuildAdjacency(
      nodes.Count,
      edges,
      nodeIndexByInstanceId,
      out var neighborIdsByNodeIndex,
      out var incidentEdgesByNodeIndex);

    return new MapGraphIndex(
      nodes.ToArray(),
      edges.ToArray(),
      nodeIndexByInstanceId,
      nodeIndexByNoteId,
      nodeIndexByTagId,
      neighborIdsByNodeIndex,
      incidentEdgesByNodeIndex);
  }

  /// <summary>
  /// Resolves one indexed node by its stable per-build id.
  /// </summary>
  public bool TryGetNode(MapGraphNodeId id, out MapGraphNode node)
  {
    if (TryGetNodeIndex(id, out int nodeIndex))
    {
      node = nodes[nodeIndex];
      return true;
    }

    node = default;
    return false;
  }

  /// <summary>
  /// Maps a live scene component back to its indexed node id for the current graph.
  /// </summary>
  public bool TryGetNodeId(Component component, out MapGraphNodeId id)
  {
    if (TryGetNodeIndex(component, out int nodeIndex))
    {
      id = nodes[nodeIndex].Id;
      return true;
    }

    id = MapGraphNodeId.None;
    return false;
  }

  /// <summary>
  /// Resolves the indexed star id for a runtime note id.
  /// </summary>
  public bool TryGetNodeIdByNoteId(string noteId, out MapGraphNodeId id)
  {
    if (!string.IsNullOrWhiteSpace(noteId) && nodeIndexByNoteId.TryGetValue(noteId, out int nodeIndex))
    {
      id = nodes[nodeIndex].Id;
      return true;
    }

    id = MapGraphNodeId.None;
    return false;
  }

  /// <summary>
  /// Resolves the indexed tag node id for a runtime tag id.
  /// </summary>
  public bool TryGetNodeIdByTagId(int tagId, out MapGraphNodeId id)
  {
    if (nodeIndexByTagId.TryGetValue(tagId, out int nodeIndex))
    {
      id = nodes[nodeIndex].Id;
      return true;
    }

    id = MapGraphNodeId.None;
    return false;
  }

  /// <summary>
  /// Returns the live Star component for a note id when that note still exists in the current graph.
  /// </summary>
  public bool TryGetStar(string noteId, out Star star)
  {
    if (!string.IsNullOrWhiteSpace(noteId) &&
        nodeIndexByNoteId.TryGetValue(noteId, out int nodeIndex) &&
        nodes[nodeIndex].Star != null)
    {
      star = nodes[nodeIndex].Star;
      return true;
    }

    star = null;
    return false;
  }

  /// <summary>
  /// Returns the live TagNode component for a tag id when that tag still exists in the current graph.
  /// </summary>
  public bool TryGetTagNode(int tagId, out TagNode tagNode)
  {
    if (nodeIndexByTagId.TryGetValue(tagId, out int nodeIndex) &&
        nodes[nodeIndex].TagNode != null)
    {
      tagNode = nodes[nodeIndex].TagNode;
      return true;
    }

    tagNode = null;
    return false;
  }

  /// <summary>
  /// Returns the neighbors for one node.
  /// </summary>
  public IReadOnlyList<MapGraphNodeId> GetNeighborIds(MapGraphNodeId id)
  {
    return TryGetNodeIndex(id, out int nodeIndex)
      ? neighborIdsByNodeIndex[nodeIndex]
      : EmptyNeighborIds;
  }

  /// <summary>
  /// Returns the incident edges for one node.
  /// </summary>
  public IReadOnlyList<MapGraphEdge> GetIncidentEdges(MapGraphNodeId id)
  {
    return TryGetNodeIndex(id, out int nodeIndex)
      ? incidentEdgesByNodeIndex[nodeIndex]
      : EmptyEdges;
  }

  // Stars are keyed by runtime note id because focus and note-note links address notes, not scene ids.
  private static void RegisterStars(
    IReadOnlyList<Star> stars,
    List<MapGraphNode> nodes,
    Dictionary<int, int> nodeIndexByInstanceId,
    Dictionary<string, int> nodeIndexByNoteId)
  {
    if (stars == null)
      return;

    for (int i = 0; i < stars.Count; i++)
    {
      Star star = stars[i];
      string noteId = star?.Data?.Id;
      if (star == null || string.IsNullOrWhiteSpace(noteId) || nodeIndexByNoteId.ContainsKey(noteId))
        continue;

      var id = new MapGraphNodeId(star.GetInstanceID());
      // Node ids are tied to the current engine-built map and must not be persisted across rebuilds.
      if (!id.IsValid || nodeIndexByInstanceId.ContainsKey(id.Value))
        continue;

      AddNode(
        new MapGraphNode(
          id,
          MapGraphNodeKind.Star,
          star,
          star.transform,
          star,
          null,
          noteId,
          0),
        nodes,
        nodeIndexByInstanceId);

      nodeIndexByNoteId[noteId] = nodes.Count - 1;
    }
  }

  private static void RegisterTagNodes(
    IReadOnlyList<TagNode> tagNodes,
    List<MapGraphNode> nodes,
    Dictionary<int, int> nodeIndexByInstanceId,
    Dictionary<int, int> nodeIndexByTagId)
  {
    if (tagNodes == null)
      return;

    for (int i = 0; i < tagNodes.Count; i++)
    {
      TagNode tagNode = tagNodes[i];
      if (tagNode == null || nodeIndexByTagId.ContainsKey(tagNode.UserTagId))
        continue;

      var id = new MapGraphNodeId(tagNode.GetInstanceID());
      // The same scene component can only appear once, even if the source lists contain duplicates.
      if (!id.IsValid || nodeIndexByInstanceId.ContainsKey(id.Value))
        continue;

      AddNode(
        new MapGraphNode(
          id,
          MapGraphNodeKind.Tag,
          tagNode,
          tagNode.transform,
          null,
          tagNode,
          string.Empty,
          tagNode.UserTagId),
        nodes,
        nodeIndexByInstanceId);

      nodeIndexByTagId[tagNode.UserTagId] = nodes.Count - 1;
    }
  }

  private static void AddNode(
    MapGraphNode node,
    List<MapGraphNode> nodes,
    Dictionary<int, int> nodeIndexByInstanceId)
  {
    nodeIndexByInstanceId[node.Id.Value] = nodes.Count;
    nodes.Add(node);
  }

  private static void RegisterNoteNoteEdges(
    IReadOnlyList<MapRuntimeContext.RuntimeNoteLink> links,
    List<MapGraphNode> nodes,
    Dictionary<string, int> nodeIndexByNoteId,
    HashSet<EdgeKey> edgeKeys,
    List<MapGraphEdge> edges)
  {
    if (links == null)
      return;

    for (int i = 0; i < links.Count; i++)
    {
      var link = links[i];
      if (link == null ||
          string.IsNullOrWhiteSpace(link.SourceId) ||
          string.IsNullOrWhiteSpace(link.TargetId) ||
          string.Equals(link.SourceId, link.TargetId, StringComparison.Ordinal))
      {
        continue;
      }

      if (!nodeIndexByNoteId.TryGetValue(link.SourceId, out int sourceIndex) ||
          !nodeIndexByNoteId.TryGetValue(link.TargetId, out int targetIndex))
      {
        continue;
      }

      AddEdge(MapGraphEdgeKind.NoteNote, sourceIndex, targetIndex, nodes, edgeKeys, edges);
    }
  }

  // Tag membership lives on NoteData, so note-tag edges are derived from registered star nodes.
  private static void RegisterNoteTagEdges(
    List<MapGraphNode> nodes,
    Dictionary<int, int> nodeIndexByTagId,
    HashSet<EdgeKey> edgeKeys,
    List<MapGraphEdge> edges)
  {
    for (int nodeIndex = 0; nodeIndex < nodes.Count; nodeIndex++)
    {
      MapGraphNode node = nodes[nodeIndex];
      if (node.Kind != MapGraphNodeKind.Star ||
          node.Star == null ||
          node.Star.Data == null ||
          node.Star.Data.TagIds == null)
      {
        continue;
      }

      List<int> tagIds = node.Star.Data.TagIds;
      for (int tagIndex = 0; tagIndex < tagIds.Count; tagIndex++)
      {
        if (nodeIndexByTagId.TryGetValue(tagIds[tagIndex], out int tagNodeIndex))
          AddEdge(MapGraphEdgeKind.NoteTag, nodeIndex, tagNodeIndex, nodes, edgeKeys, edges);
      }
    }
  }

  private static void AddEdge(
    MapGraphEdgeKind kind,
    int nodeAIndex,
    int nodeBIndex,
    List<MapGraphNode> nodes,
    HashSet<EdgeKey> edgeKeys,
    List<MapGraphEdge> edges)
  {
    if (nodeAIndex == nodeBIndex ||
        nodeAIndex < 0 ||
        nodeAIndex >= nodes.Count ||
        nodeBIndex < 0 ||
        nodeBIndex >= nodes.Count)
    {
      return;
    }

    MapGraphNodeId nodeA = nodes[nodeAIndex].Id;
    MapGraphNodeId nodeB = nodes[nodeBIndex].Id;
    var key = new EdgeKey(nodeA, nodeB, kind);
    // Edges are treated as undirected for rendering and adjacency; reciprocal payload links collapse here.
    if (!edgeKeys.Add(key))
      return;

    edges.Add(new MapGraphEdge(kind, nodeA, nodeB));
  }

  private static void BuildAdjacency(
    int nodeCount,
    List<MapGraphEdge> edges,
    Dictionary<int, int> nodeIndexByInstanceId,
    out MapGraphNodeId[][] neighborIdsByNodeIndex,
    out MapGraphEdge[][] incidentEdgesByNodeIndex)
  {
    // Count degrees first so adjacency arrays are exact-size and do not allocate per-node List objects.
    var degreeByNodeIndex = new int[nodeCount];
    for (int i = 0; i < edges.Count; i++)
    {
      MapGraphEdge edge = edges[i];
      if (!TryResolveEdgeIndices(edge, nodeIndexByInstanceId, out int nodeAIndex, out int nodeBIndex))
        continue;

      degreeByNodeIndex[nodeAIndex]++;
      degreeByNodeIndex[nodeBIndex]++;
    }

    neighborIdsByNodeIndex = new MapGraphNodeId[nodeCount][];
    incidentEdgesByNodeIndex = new MapGraphEdge[nodeCount][];
    for (int i = 0; i < nodeCount; i++)
    {
      int degree = degreeByNodeIndex[i];
      neighborIdsByNodeIndex[i] = degree == 0 ? EmptyNeighborIds : new MapGraphNodeId[degree];
      incidentEdgesByNodeIndex[i] = degree == 0 ? EmptyEdges : new MapGraphEdge[degree];
    }

    Array.Clear(degreeByNodeIndex, 0, degreeByNodeIndex.Length);
    // Reuse degree counters as write cursors during the second pass.
    for (int i = 0; i < edges.Count; i++)
    {
      MapGraphEdge edge = edges[i];
      if (!TryResolveEdgeIndices(edge, nodeIndexByInstanceId, out int nodeAIndex, out int nodeBIndex))
        continue;

      int writeA = degreeByNodeIndex[nodeAIndex]++;
      int writeB = degreeByNodeIndex[nodeBIndex]++;
      neighborIdsByNodeIndex[nodeAIndex][writeA] = edge.NodeB;
      neighborIdsByNodeIndex[nodeBIndex][writeB] = edge.NodeA;
      incidentEdgesByNodeIndex[nodeAIndex][writeA] = edge;
      incidentEdgesByNodeIndex[nodeBIndex][writeB] = edge;
    }
  }

  private bool TryGetNodeIndex(MapGraphNodeId id, out int nodeIndex)
  {
    if (id.IsValid && nodeIndexByInstanceId.TryGetValue(id.Value, out nodeIndex))
      return true;

    nodeIndex = -1;
    return false;
  }

  private bool TryGetNodeIndex(Component component, out int nodeIndex)
  {
    if (component == null)
    {
      nodeIndex = -1;
      return false;
    }

    if (nodeIndexByInstanceId.TryGetValue(component.GetInstanceID(), out nodeIndex))
      return true;

    nodeIndex = -1;
    return false;
  }

  private readonly struct EdgeKey : IEquatable<EdgeKey>
  {
    private readonly int nodeAId;
    private readonly int nodeBId;
    private readonly MapGraphEdgeKind kind;

    public EdgeKey(MapGraphNodeId nodeA, MapGraphNodeId nodeB, MapGraphEdgeKind kind)
    {
      if (nodeA.Value <= nodeB.Value)
      {
        nodeAId = nodeA.Value;
        nodeBId = nodeB.Value;
      }
      else
      {
        nodeAId = nodeB.Value;
        nodeBId = nodeA.Value;
      }

      this.kind = kind;
    }

    public bool Equals(EdgeKey other)
    {
      return nodeAId == other.nodeAId && nodeBId == other.nodeBId && kind == other.kind;
    }

    public override bool Equals(object obj)
    {
      return obj is EdgeKey other && Equals(other);
    }

    public override int GetHashCode()
    {
      unchecked
      {
        int hash = nodeAId;
        hash = (hash * 397) ^ nodeBId;
        hash = (hash * 397) ^ (int)kind;
        return hash;
      }
    }
  }

  private static bool TryResolveEdgeIndices(
    MapGraphEdge edge,
    Dictionary<int, int> nodeIndexByInstanceId,
    out int nodeAIndex,
    out int nodeBIndex)
  {
    if (nodeIndexByInstanceId.TryGetValue(edge.NodeA.Value, out nodeAIndex) &&
        nodeIndexByInstanceId.TryGetValue(edge.NodeB.Value, out nodeBIndex))
    {
      return true;
    }

    nodeAIndex = -1;
    nodeBIndex = -1;
    return false;
  }
}
