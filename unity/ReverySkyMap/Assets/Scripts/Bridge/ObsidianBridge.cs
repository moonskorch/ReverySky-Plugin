using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;

public class ObsidianBridge : MonoBehaviour
{
  private const string ExpectedProtocolVersion = "2.0.0";
  private const string GraphSetMessageType = "graph:set";
  private const string NoteFocusMessageType = "note:focus";

#if UNITY_WEBGL && !UNITY_EDITOR
  [DllImport("__Internal")]
  private static extern void ReverySkyBridgePostNoteOpen(string noteId, string notePath);
#endif

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

  private void OnEnable()
  {
    MapRuntimeContext.OnOpenNoteRequested += HandleOpenNoteRequested;
  }

  private void OnDisable()
  {
    MapRuntimeContext.OnOpenNoteRequested -= HandleOpenNoteRequested;
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

    if (!string.Equals(envelope.protocolVersion, ExpectedProtocolVersion, StringComparison.Ordinal))
    {
      Debug.LogWarning(
        $"[ObsidianBridge] Ignoring graph:set due to protocolVersion mismatch. expected={ExpectedProtocolVersion}, got={envelope?.protocolVersion ?? "<null>"}");
      return;
    }

    if (!string.Equals(envelope.type, GraphSetMessageType, StringComparison.Ordinal))
    {
      Debug.LogWarning(
        $"[ObsidianBridge] Ignoring graph:set due to message type mismatch. expected={GraphSetMessageType}, got={envelope?.type ?? "<null>"}");
      return;
    }

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
        Name = string.IsNullOrWhiteSpace(note.title) ? GameSettings.DefaultTitle : note.title,
        Path = note.path,
        DateTime = ParseDate(note.date),
        Length = Mathf.Max(0, note.size),
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

  public void OnNoteFocus(string json)
  {
    MapRuntimeContext.EnableRuntimeMode();

    if (string.IsNullOrWhiteSpace(json))
      return;

    NoteFocusEnvelope envelope;
    try
    {
      envelope = JsonUtility.FromJson<NoteFocusEnvelope>(json);
    }
    catch (Exception ex)
    {
      Debug.LogWarning($"[ObsidianBridge] Invalid note:focus payload: {ex.Message}");
      return;
    }

    if (!string.Equals(envelope.protocolVersion, ExpectedProtocolVersion, StringComparison.Ordinal))
    {
      Debug.LogWarning(
        $"[ObsidianBridge] Ignoring note:focus due to protocolVersion mismatch. expected={ExpectedProtocolVersion}, got={envelope?.protocolVersion ?? "<null>"}");
      return;
    }

    if (!string.Equals(envelope.type, NoteFocusMessageType, StringComparison.Ordinal))
    {
      Debug.LogWarning(
        $"[ObsidianBridge] Ignoring note:focus due to message type mismatch. expected={NoteFocusMessageType}, got={envelope?.type ?? "<null>"}");
      return;
    }

    var payload = envelope?.payload;
    var noteId = payload?.id ?? string.Empty;
    var notePath = payload?.path ?? string.Empty;
    if (string.IsNullOrWhiteSpace(noteId) && string.IsNullOrWhiteSpace(notePath))
      return;

    var cartographer = Cartographer.I;
    if (cartographer == null)
      return;

    cartographer.FocusRuntimeNote(noteId, notePath);
  }

  private static void HandleOpenNoteRequested(string noteId, string notePath)
  {
    var safeId = noteId ?? string.Empty;
    var safePath = notePath ?? string.Empty;

#if UNITY_WEBGL && !UNITY_EDITOR
    ReverySkyBridgePostNoteOpen(safeId, safePath);
#else
    Debug.Log($"[ObsidianBridge] note:open requested (Editor/Non-WebGL): id={safeId}, path={safePath}");
#endif
  }

  private static DateTime ParseDate(string value)
  {
    return TryParseIso(value, out var dt) ? dt : DateTime.MinValue;
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
    public string protocolVersion;
    public string type;
    public GraphPayload payload;
  }

  [Serializable]
  private class NoteFocusEnvelope
  {
    public string protocolVersion;
    public string type;
    public NoteFocusPayload payload;
  }

  [Serializable]
  private class NoteFocusPayload
  {
    public string id;
    public string path;
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
    public string date;
    public int size;
  }

  [Serializable]
  private class GraphLink
  {
    public string sourceId;
    public string targetId;
    public float weight;
  }
}
