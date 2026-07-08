/// <summary>
/// Distinguishes note-backed stars from tag hub nodes in the visual graph index.
/// </summary>
public enum MapGraphNodeKind
{
  Star,
  Tag
}

/// <summary>
/// Distinguishes links between notes from membership links between notes and tags.
/// </summary>
public enum MapGraphEdgeKind
{
  NoteNote,
  NoteTag
}
