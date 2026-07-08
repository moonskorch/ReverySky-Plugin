/// <summary>
/// Read-only topology relationship between two indexed map nodes.
/// Edges are treated as undirected by line rendering and adjacency lookup.
/// </summary>
public readonly struct MapGraphEdge
{
  public MapGraphEdge(
    MapGraphEdgeKind kind,
    MapGraphNodeId nodeA,
    MapGraphNodeId nodeB)
  {
    Kind = kind;
    NodeA = nodeA;
    NodeB = nodeB;
  }

  public MapGraphEdgeKind Kind { get; }
  /// <summary>
  /// First endpoint in the current built map.
  /// </summary>
  public MapGraphNodeId NodeA { get; }
  /// <summary>
  /// Second endpoint in the current built map.
  /// </summary>
  public MapGraphNodeId NodeB { get; }
}
