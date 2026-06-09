using System;
using System.Collections.Generic;
using UnityEngine;

public enum SampleGraphScenario
{
  Normal,
  Hub,
  Clusters
}

[Serializable]
public struct SampleGraphSettings
{
  public SampleGraphScenario Scenario;
  public int NoteCount;
  public int TagPoolSize;
  public int DateSpanDays;
  public int MaxTagsPerNote;
  public int ExtraLinks;
}

public sealed class SampleGraphData
{
  public List<NoteData> Notes { get; }
  public List<MapRuntimeContext.RuntimeNoteLink> Links { get; }
  public Dictionary<int, string> TagNames { get; }

  public SampleGraphData(
    List<NoteData> notes,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    Dictionary<int, string> tagNames)
  {
    Notes = notes ?? new List<NoteData>();
    Links = links ?? new List<MapRuntimeContext.RuntimeNoteLink>();
    TagNames = tagNames ?? new Dictionary<int, string>();
  }
}

public class SampleDataGenerator : MonoBehaviour
{
  [Header("Injection")]
  [SerializeField] private bool injectSampleData = false;

  [Header("Sample graph")]
  [SerializeField] private SampleGraphScenario sampleScenario = SampleGraphScenario.Normal;
  [SerializeField] private int sampleNoteCount = 320;
  [SerializeField] private int sampleTagPoolSize = 24;
  [SerializeField] private int sampleDateSpanDays = 720;
  [SerializeField] private int sampleMaxTagsPerNote = 3;
  [SerializeField] private int sampleExtraLinks = 480;

  public bool TryInjectSampleDataIfNeeded()
  {
    if (!injectSampleData || MapRuntimeContext.HasRuntimeNotes)
      return false;

    var settings = new SampleGraphSettings
    {
      Scenario = sampleScenario,
      NoteCount = sampleNoteCount,
      TagPoolSize = sampleTagPoolSize,
      DateSpanDays = sampleDateSpanDays,
      MaxTagsPerNote = sampleMaxTagsPerNote,
      ExtraLinks = sampleExtraLinks
    };

    var sampleGraph = GenerateGraph(settings, DateTime.Now.Date);
    MapRuntimeContext.SetTagNames(sampleGraph.TagNames);
    MapRuntimeContext.SetLinks(sampleGraph.Links);
    MapRuntimeContext.SetNotes(sampleGraph.Notes);

    Debug.Log(
      $"[CartographerSampleData] Injected scenario={settings.Scenario} notes={sampleGraph.Notes.Count} tags={sampleGraph.TagNames.Count} links={sampleGraph.Links.Count}");
    return true;
  }

  public static SampleGraphData GenerateGraph(SampleGraphSettings settings, DateTime anchorDate)
  {
    settings = NormalizeSettings(settings);
    anchorDate = anchorDate.Date;

    var tagIds = BuildTagIds(settings.TagPoolSize);
    var tagNames = BuildTagNames(tagIds);
    var notes = BuildNotes(settings, anchorDate, tagIds);
    var links = BuildLinks(settings, notes, anchorDate);

    return new SampleGraphData(notes, links, tagNames);
  }

  private static SampleGraphSettings NormalizeSettings(SampleGraphSettings settings)
  {
    settings.NoteCount = Mathf.Clamp(settings.NoteCount, 0, 10000);
    settings.TagPoolSize = Mathf.Clamp(settings.TagPoolSize, 0, 256);
    settings.DateSpanDays = Mathf.Clamp(settings.DateSpanDays, 1, 3650);
    settings.MaxTagsPerNote = Mathf.Clamp(settings.MaxTagsPerNote, 0, 8);
    settings.ExtraLinks = Mathf.Max(0, settings.ExtraLinks);
    return settings;
  }

  private static List<NoteData> BuildNotes(
    SampleGraphSettings settings,
    DateTime anchorDate,
    List<int> tagIds)
  {
    var notes = new List<NoteData>(settings.NoteCount);
    if (settings.NoteCount <= 0)
      return notes;

    var baseRng = new System.Random(ComputeSeed(anchorDate, settings.NoteCount, settings.DateSpanDays, 17));
    var tagRng = new System.Random(ComputeSeed(anchorDate, settings.NoteCount, settings.TagPoolSize, settings.MaxTagsPerNote, 31));
    int clusterCount = GetClusterCount(settings);
    int[] clusterStarts = null;
    int[] clusterSizes = null;
    List<int>[] clusterTagPools = null;

    if (settings.Scenario == SampleGraphScenario.Clusters)
    {
      BuildClusterLayout(settings.NoteCount, clusterCount, out clusterStarts, out clusterSizes);
      clusterTagPools = BuildClusterTagPools(tagIds, clusterCount);
    }

    for (int i = 0; i < settings.NoteCount; i++)
    {
      int dayIndex = settings.NoteCount <= 1
        ? 0
        : (i * (settings.DateSpanDays - 1)) / (settings.NoteCount - 1);
      int dayJitter = baseRng.Next(-2, 3);
      int daysAgo = Mathf.Clamp(dayIndex + dayJitter, 0, settings.DateSpanDays - 1);

      var note = new NoteData
      {
        Id = $"sample-{i + 1}",
        Name = $"{i + 1} Sample Note",
        Path = $"Sample/{i + 1}.md",
        DateTime = anchorDate.AddDays(-daysAgo),
        Length = BuildNoteLength(anchorDate, i, settings),
        CrystalType = CrystalType.Unknown,
        SphereType = SphereType.Unknown,
        TagIds = new List<int>()
      };

      IReadOnlyList<int> tagPool = tagIds;
      if (settings.Scenario == SampleGraphScenario.Clusters)
      {
        int clusterIndex = GetClusterIndex(i, clusterStarts, clusterSizes);
        tagPool = clusterTagPools[clusterIndex];
      }

      AssignTags(note, tagPool, settings.MaxTagsPerNote, tagRng);
      notes.Add(note);
    }

    return notes;
  }

  private static int BuildNoteLength(DateTime anchorDate, int noteIndex, SampleGraphSettings settings)
  {
    var rng = new System.Random(ComputeSeed(anchorDate, noteIndex, settings.NoteCount, (int)settings.Scenario, 109));
    int scenarioBias = settings.Scenario switch
    {
      SampleGraphScenario.Hub => 3,
      SampleGraphScenario.Clusters => 5,
      _ => 1
    };

    int baseSize = 240 + (noteIndex % 7) * 96;
    int variability = 180 + (scenarioBias * 40);
    int randomBurst = rng.Next(0, 1400 + (scenarioBias * 250));
    int clusterShape = (noteIndex % 5) * (scenarioBias * 37);

    return Math.Max(1, baseSize + variability + randomBurst + clusterShape);
  }

  private static void AssignTags(
    NoteData note,
    IReadOnlyList<int> tagPool,
    int maxTagsPerNote,
    System.Random rng)
  {
    note.TagIds = new List<int>();
    if (tagPool == null || tagPool.Count == 0 || maxTagsPerNote <= 0)
      return;

    int requestedTagCount = rng.Next(1, maxTagsPerNote + 1);
    int tagCount = Math.Min(requestedTagCount, tagPool.Count);
    var selected = new HashSet<int>();
    var orderedSelections = new List<int>(tagCount);

    while (selected.Count < tagCount)
    {
      int tagId = tagPool[rng.Next(0, tagPool.Count)];
      if (selected.Add(tagId))
        orderedSelections.Add(tagId);
    }

    note.TagIds = orderedSelections;
  }

  private static List<MapRuntimeContext.RuntimeNoteLink> BuildLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    DateTime anchorDate)
  {
    var links = new List<MapRuntimeContext.RuntimeNoteLink>();
    if (notes == null || notes.Count < 2)
      return links;

    var usedPairs = new HashSet<long>();
    int maxExtraLinks = GetMaxExtraLinks(settings, notes.Count);
    int densityLimit = notes.Count * 8;
    int extraLinks = Math.Min(settings.ExtraLinks, Math.Min(densityLimit, maxExtraLinks));
    var linkRng = new System.Random(ComputeSeed(anchorDate, settings.NoteCount, settings.ExtraLinks, (int)settings.Scenario, 73));

    switch (settings.Scenario)
    {
      case SampleGraphScenario.Hub:
        BuildHubLinks(notes, extraLinks, linkRng, links, usedPairs);
        break;
      case SampleGraphScenario.Clusters:
        BuildClusterLinks(notes, settings.NoteCount, extraLinks, linkRng, links, usedPairs);
        break;
      default:
        BuildNormalLinks(notes, extraLinks, linkRng, links, usedPairs);
        break;
    }

    return links;
  }

  private static void BuildNormalLinks(
    List<NoteData> notes,
    int extraLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    for (int i = 0; i < notes.Count - 1; i++)
      TryAddUniqueLink(i, i + 1, notes, links, usedPairs, 1f);

    int created = 0;
    int safety = extraLinks * 12 + 64;
    while (created < extraLinks && safety-- > 0)
    {
      int sourceIndex = rng.Next(0, notes.Count);
      int targetIndex = rng.Next(0, notes.Count);
      if (TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng)))
        created++;
    }
  }

  private static void BuildHubLinks(
    List<NoteData> notes,
    int extraLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    for (int i = 0; i < notes.Count - 1; i++)
      TryAddUniqueLink(i, i + 1, notes, links, usedPairs, 1f);

    int hubCount = Math.Min(3, notes.Count);
    var hubs = new int[hubCount];
    for (int i = 0; i < hubCount; i++)
      hubs[i] = i;

    int created = 0;
    for (int hubOffset = 0; created < extraLinks && hubOffset < hubCount; hubOffset++)
    {
      for (int noteIndex = 0; created < extraLinks && noteIndex < notes.Count; noteIndex++)
      {
        if (TryAddUniqueLink(noteIndex, hubs[hubOffset], notes, links, usedPairs, RandomWeight(rng)))
          created++;
      }
    }

    int safety = extraLinks * 12 + 64;
    while (created < extraLinks && safety-- > 0)
    {
      int sourceIndex = rng.Next(0, notes.Count);
      int targetIndex = rng.Next(0, notes.Count);
      if (TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng)))
        created++;
    }
  }

  private static void BuildClusterLinks(
    List<NoteData> notes,
    int noteCount,
    int extraLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    int clusterCount = Math.Min(4, noteCount);
    BuildClusterLayout(noteCount, clusterCount, out var clusterStarts, out var clusterSizes);

    for (int clusterIndex = 0; clusterIndex < clusterCount; clusterIndex++)
    {
      int start = clusterStarts[clusterIndex];
      int size = clusterSizes[clusterIndex];
      for (int i = 0; i < size - 1; i++)
        TryAddUniqueLink(start + i, start + i + 1, notes, links, usedPairs, 1f);
    }

    int created = 0;
    int safety = extraLinks * 12 + 64;
    while (created < extraLinks && safety-- > 0)
    {
      int clusterIndex = rng.Next(0, clusterCount);
      int size = clusterSizes[clusterIndex];
      if (size < 2)
        continue;

      int start = clusterStarts[clusterIndex];
      int sourceIndex = start + rng.Next(0, size);
      int targetIndex = start + rng.Next(0, size);
      if (TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng)))
        created++;
    }
  }

  private static bool TryAddUniqueLink(
    int sourceIndex,
    int targetIndex,
    List<NoteData> notes,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs,
    float weight)
  {
    if (notes == null || sourceIndex < 0 || targetIndex < 0)
      return false;

    if (sourceIndex >= notes.Count || targetIndex >= notes.Count)
      return false;

    if (sourceIndex == targetIndex)
      return false;

    long pairKey = GetUndirectedPairKey(sourceIndex, targetIndex);
    if (!usedPairs.Add(pairKey))
      return false;

    links.Add(new MapRuntimeContext.RuntimeNoteLink
    {
      SourceId = notes[sourceIndex].Id,
      TargetId = notes[targetIndex].Id,
      Weight = weight > 0f ? weight : 1f
    });
    return true;
  }

  private static float RandomWeight(System.Random rng)
  {
    return 0.75f + ((float)rng.NextDouble() * 1.75f);
  }

  private static List<int> BuildTagIds(int tagPoolSize)
  {
    var tagIds = new List<int>(tagPoolSize);
    for (int i = 0; i < tagPoolSize; i++)
      tagIds.Add(101 + i);

    return tagIds;
  }

  private static Dictionary<int, string> BuildTagNames(List<int> tagIds)
  {
    var tagNames = new Dictionary<int, string>(tagIds.Count);
    for (int i = 0; i < tagIds.Count; i++)
      tagNames[tagIds[i]] = $"tag {tagIds[i]}";

    return tagNames;
  }

  private static List<int>[] BuildClusterTagPools(List<int> tagIds, int clusterCount)
  {
    var clusterTagPools = new List<int>[clusterCount];
    BuildClusterLayout(tagIds.Count, clusterCount, out var clusterStarts, out var clusterSizes);

    for (int clusterIndex = 0; clusterIndex < clusterCount; clusterIndex++)
    {
      int start = clusterStarts[clusterIndex];
      int size = clusterSizes[clusterIndex];
      var pool = new List<int>(size);
      for (int i = 0; i < size; i++)
        pool.Add(tagIds[start + i]);

      clusterTagPools[clusterIndex] = pool;
    }

    return clusterTagPools;
  }

  private static int GetClusterCount(SampleGraphSettings settings)
  {
    return settings.Scenario == SampleGraphScenario.Clusters
      ? Math.Min(4, settings.NoteCount)
      : 0;
  }

  private static int GetClusterIndex(int noteIndex, int[] clusterStarts, int[] clusterSizes)
  {
    for (int i = 0; i < clusterStarts.Length; i++)
    {
      int start = clusterStarts[i];
      int end = start + clusterSizes[i];
      if (noteIndex >= start && noteIndex < end)
        return i;
    }

    return Math.Max(0, clusterStarts.Length - 1);
  }

  private static void BuildClusterLayout(
    int itemCount,
    int clusterCount,
    out int[] clusterStarts,
    out int[] clusterSizes)
  {
    clusterStarts = new int[clusterCount];
    clusterSizes = new int[clusterCount];
    if (clusterCount <= 0)
      return;

    int baseSize = itemCount / clusterCount;
    int remainder = itemCount % clusterCount;
    int cursor = 0;
    for (int i = 0; i < clusterCount; i++)
    {
      clusterStarts[i] = cursor;
      clusterSizes[i] = baseSize + (i < remainder ? 1 : 0);
      cursor += clusterSizes[i];
    }
  }

  private static int GetMaxExtraLinks(SampleGraphSettings settings, int noteCount)
  {
    if (noteCount < 2)
      return 0;

    int notePairLimit = (noteCount * (noteCount - 1)) / 2;
    int baseChainLimit = noteCount - 1;

    if (settings.Scenario != SampleGraphScenario.Clusters)
      return Math.Max(0, notePairLimit - baseChainLimit);

    int clusterCount = GetClusterCount(settings);
    BuildClusterLayout(noteCount, clusterCount, out _, out var clusterSizes);
    int clusterExtraLimit = 0;
    for (int i = 0; i < clusterSizes.Length; i++)
    {
      int size = clusterSizes[i];
      if (size >= 2)
        clusterExtraLimit += ((size - 1) * (size - 2)) / 2;
    }

    return Math.Max(0, clusterExtraLimit);
  }

  private static long GetUndirectedPairKey(int a, int b)
  {
    int low = Math.Min(a, b);
    int high = Math.Max(a, b);
    return ((long)low << 32) | (uint)high;
  }

  private static int ComputeSeed(DateTime anchorDate, int a, int b, int salt)
  {
    unchecked
    {
      long ticks = anchorDate.Date.Ticks;
      int seed = 17;
      seed = (seed * 31) + (int)ticks;
      seed = (seed * 31) + (int)(ticks >> 32);
      seed = (seed * 31) + a;
      seed = (seed * 31) + b;
      seed = (seed * 31) + salt;
      return seed;
    }
  }

  private static int ComputeSeed(DateTime anchorDate, int a, int b, int c, int salt)
  {
    unchecked
    {
      long ticks = anchorDate.Date.Ticks;
      int seed = 17;
      seed = (seed * 31) + (int)ticks;
      seed = (seed * 31) + (int)(ticks >> 32);
      seed = (seed * 31) + a;
      seed = (seed * 31) + b;
      seed = (seed * 31) + c;
      seed = (seed * 31) + salt;
      return seed;
    }
  }
}
