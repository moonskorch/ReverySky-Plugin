using UnityEngine;

/// <summary>
/// Read-only view of one instantiated visual node in the current built map.
/// It keeps live scene references, but does not own or mutate the referenced GameObject.
/// </summary>
public sealed class MapGraphNode
{
  public MapGraphNode(
    MapGraphNodeId id,
    MapGraphNodeKind kind,
    Component component,
    Transform transform,
    Star star,
    TagNode tagNode,
    string noteId,
    int tagId)
  {
    Id = id;
    Kind = kind;
    Component = component;
    Transform = transform;
    Star = star;
    TagNode = tagNode;
    NoteId = noteId ?? string.Empty;
    TagId = tagId;
  }

  public MapGraphNodeId Id { get; }
  public MapGraphNodeKind Kind { get; }
  /// <summary>
  /// Scene component used as the stable lookup target while the current built map is valid.
  /// </summary>
  public Component Component { get; }
  /// <summary>
  /// Live transform used by renderers and culling; positions are not copied into the index.
  /// </summary>
  public Transform Transform { get; }
  /// <summary>
  /// Populated only when Kind is Star.
  /// </summary>
  public Star Star { get; }
  /// <summary>
  /// Populated only when Kind is Tag.
  /// </summary>
  public TagNode TagNode { get; }
  /// <summary>
  /// Runtime note id for star nodes; empty for tag nodes.
  /// </summary>
  public string NoteId { get; }
  /// <summary>
  /// Runtime tag id for tag nodes; zero for star nodes.
  /// </summary>
  public int TagId { get; }
}
