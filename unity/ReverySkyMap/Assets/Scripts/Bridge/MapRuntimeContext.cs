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
    ApplyDirectLinkCounts();
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

  /// <summary>
  /// Derives each note's direct-note neighbor count from the current runtime links.
  /// Uses a temporary neighbor index so duplicate or reciprocal links count as one neighbor,
  /// then stores only the final count on NoteData to avoid keeping a second graph source of truth.
  /// </summary>
  private static void ApplyDirectLinkCounts()
  {
    if (Notes == null || Notes.Count == 0)
      return;

    var noteIds = new HashSet<string>(StringComparer.Ordinal);
    foreach (var note in Notes)
    {
      if (note != null && !string.IsNullOrWhiteSpace(note.Id))
        noteIds.Add(note.Id);
    }

    // Count direct note-note neighbors only; tag edges are built separately by layout engines.
    var neighborIdsByNoteId = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

    if (Links != null)
    {
      foreach (var link in Links)
      {
        // Links to notes outside the effective graph must not inflate visible star brightness.
        if (link == null ||
            !noteIds.Contains(link.SourceId ?? string.Empty) ||
            !noteIds.Contains(link.TargetId ?? string.Empty))
        {
          continue;
        }

        AddNeighbor(neighborIdsByNoteId, link.SourceId, link.TargetId);
        AddNeighbor(neighborIdsByNoteId, link.TargetId, link.SourceId);
      }
    }

    foreach (var note in Notes)
    {
      if (note == null)
        continue;

      if (string.IsNullOrWhiteSpace(note.Id) ||
          !neighborIdsByNoteId.TryGetValue(note.Id, out var neighborIds))
      {
        note.DirectLinkCount = 0;
      }
      else
      {
        note.DirectLinkCount = neighborIds.Count;
      }
    }
  }

  private static void AddNeighbor(
    Dictionary<string, HashSet<string>> neighborIdsByNoteId,
    string noteId,
    string neighborId)
  {
    if (!neighborIdsByNoteId.TryGetValue(noteId, out var neighborIds))
    {
      neighborIds = new HashSet<string>(StringComparer.Ordinal);
      neighborIdsByNoteId[noteId] = neighborIds;
    }

    neighborIds.Add(neighborId);
  }
}
