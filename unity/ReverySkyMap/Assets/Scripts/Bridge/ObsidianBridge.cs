using System;
using System.Collections.Generic;
using UnityEngine;

public class ObsidianBridge : MonoBehaviour
{
  [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
  private static void EnsureInstance()
  {
#if UNITY_2023_1_OR_NEWER
    if (FindFirstObjectByType<ObsidianBridge>() != null)
      return;
#else
    if (FindObjectOfType<ObsidianBridge>() != null)
      return;
#endif

    var go = new GameObject("ObsidianBridge");
    DontDestroyOnLoad(go);
    go.AddComponent<ObsidianBridge>();
  }

  public void OnGraphSet(string json)
  {
    MapRuntimeContext.EnableRuntimeMode();

    if (string.IsNullOrWhiteSpace(json))
      return;

    GraphSetEnvelope envelope;
    try
    {
      envelope = JsonUtility.FromJson<GraphSetEnvelope>(json);
    }
    catch (Exception ex)
    {
      Debug.LogError($"[ObsidianBridge] Invalid graph:set payload: {ex.Message}");
      return;
    }

    if (envelope?.payload == null)
      return;

    var notes = envelope.payload.notes ?? Array.Empty<GraphNote>();
    var links = envelope.payload.links ?? Array.Empty<GraphLink>();

    var tagIdByName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    var tagNameById = new Dictionary<int, string>();
    var nextTagId = 1;

    var runtimeNotes = new List<NoteData>(notes.Length);
    var linksRuntime = new List<MapRuntimeContext.RuntimeNoteLink>(links.Length);

    foreach (var note in notes)
    {
      if (note == null)
        continue;

      var tagIds = new List<int>();
      if (note.tags != null)
      {
        foreach (var rawTag in note.tags)
        {
          if (string.IsNullOrWhiteSpace(rawTag))
            continue;

          var tag = rawTag.Trim();
          if (!tagIdByName.TryGetValue(tag, out var tagId))
          {
            tagId = nextTagId++;
            tagIdByName[tag] = tagId;
            tagNameById[tagId] = tag;
          }

          tagIds.Add(tagId);
        }
      }

      runtimeNotes.Add(new NoteData
      {
        Id = note.id ?? string.Empty,
        Name = string.IsNullOrWhiteSpace(note.title) ? (note.id ?? string.Empty) : note.title,
        Path = note.path,
        DateTime = ParseDate(note.dates),
        CrystalType = CrystalType.Unknown,
        SphereType = SphereType.Unknown,
        TagIds = tagIds,
        ScapeView = ScapeView.Planets
      });
    }

    foreach (var link in links)
    {
      if (link == null)
        continue;

      if (string.IsNullOrWhiteSpace(link.sourceId) || string.IsNullOrWhiteSpace(link.targetId))
        continue;

      if (string.Equals(link.sourceId, link.targetId, StringComparison.Ordinal))
        continue;

      linksRuntime.Add(new MapRuntimeContext.RuntimeNoteLink
      {
        SourceId = link.sourceId,
        TargetId = link.targetId,
        Weight = link.weight <= 0f ? 1f : link.weight
      });
    }

    MapRuntimeContext.SetTagNames(tagNameById);
    MapRuntimeContext.SetLinks(linksRuntime);
    MapRuntimeContext.SetNotes(runtimeNotes);

    Debug.Log($"[ObsidianBridge] graph:set applied. notes={notes.Length}, links={links.Length}, runtimeNotes={runtimeNotes.Count}, tags={tagNameById.Count}");
  }

  private static DateTime ParseDate(NoteDates dates)
  {
    if (dates == null)
      return DateTime.MinValue;

    if (TryParseIso(dates.noteDate, out var dt))
      return dt;
    if (TryParseIso(dates.created, out dt))
      return dt;
    if (TryParseIso(dates.modified, out dt))
      return dt;

    return DateTime.MinValue;
  }

  private static bool TryParseIso(string value, out DateTime dt)
  {
    dt = DateTime.MinValue;
    if (string.IsNullOrWhiteSpace(value))
      return false;

    return DateTime.TryParse(
      value,
      System.Globalization.CultureInfo.InvariantCulture,
      System.Globalization.DateTimeStyles.RoundtripKind,
      out dt);
  }

  [Serializable]
  private class GraphSetEnvelope
  {
    public GraphPayload payload;
  }

  [Serializable]
  private class GraphPayload
  {
    public GraphNote[] notes;
    public GraphLink[] links;
  }

  [Serializable]
  private class GraphNote
  {
    public string id;
    public string path;
    public string title;
    public string[] tags;
    public NoteDates dates;
  }

  [Serializable]
  private class NoteDates
  {
    public string created;
    public string modified;
    public string noteDate;
  }

  [Serializable]
  private class GraphLink
  {
    public string sourceId;
    public string targetId;
    public float weight;
  }
}
