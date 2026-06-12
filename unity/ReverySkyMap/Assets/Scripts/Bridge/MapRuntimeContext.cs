using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

/// <summary>
/// Runtime-only context for map scene.
/// Replaces app-level singletons for Obsidian integration.
/// </summary>
public static class MapRuntimeContext
{
  public class RuntimeNoteLink
  {
    public string SourceId;
    public string TargetId;
    public float Weight;
  }

  public static List<NoteData> Notes { get; private set; } = new();
  public static List<RuntimeNoteLink> Links { get; private set; } = new();
  private static Dictionary<int, string> tagNamesById = new();
  public static bool IsRuntimeMode { get; private set; } = false;
  public static int NotesVersion { get; private set; } = 0;

  public static string CurrentNoteId { get; set; } = string.Empty;

  public static MapLayoutMode MapLayoutPreference { get; set; } = MapLayoutMode.Auto;

  public static event Action<string, string> OnOpenNoteRequested;
  public static event Action OnNotesChanged;

  public static bool HasRuntimeNotes => Notes != null && Notes.Count > 0;

  public static void EnableRuntimeMode()
  {
    IsRuntimeMode = true;
  }

  public static void SetNotes(List<NoteData> notes)
  {
    IsRuntimeMode = true;
    Notes = notes ?? new List<NoteData>();
    NotesVersion++;
    OnNotesChanged?.Invoke();
  }

  public static void SetLinks(List<RuntimeNoteLink> links)
  {
    IsRuntimeMode = true;
    Links = links ?? new List<RuntimeNoteLink>();
  }

  public static void SetTagNames(Dictionary<int, string> tagsById)
  {
    tagNamesById = tagsById ?? new Dictionary<int, string>();
  }

  public static string GetTagName(int tagId)
  {
    if (tagNamesById.TryGetValue(tagId, out var name))
      return name;
    return null;
  }

  public static NoteData FindNoteById(string noteId)
  {
    if (string.IsNullOrWhiteSpace(noteId))
      return null;

    return Notes.FirstOrDefault(n => n != null && n.Id == noteId);
  }

  public static NoteData FindNoteByPath(string notePath)
  {
    if (string.IsNullOrWhiteSpace(notePath))
      return null;

    var normalizedPath = notePath.Replace('\\', '/');
    return Notes.FirstOrDefault(
      n => n != null &&
      !string.IsNullOrWhiteSpace(n.Path) &&
      string.Equals(n.Path.Replace('\\', '/'), normalizedPath, StringComparison.OrdinalIgnoreCase));
  }

  public static void RequestOpenNote(NoteData note)
  {
    if (note == null)
      return;

    CurrentNoteId = note.Id ?? string.Empty;
    Debug.Log($"[MapRuntimeContext] Open note requested: id={note.Id}, path={note.Path}");
    OnOpenNoteRequested?.Invoke(note.Id ?? string.Empty, note.Path ?? string.Empty);
  }
}
