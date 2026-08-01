using System;
using System.Collections.Generic;
using UnityEngine;

public enum SampleConnectionModel
{
  Random,
  Hubs,
  Clusters,
  SmallWorld,
  Chain
}

public enum SampleIslandMode
{
  Auto,
  One,
  Many
}

[Serializable]
public struct SampleGraphSettings
{
  public SampleConnectionModel ConnectionModel;
  public SampleIslandMode Islands;
  public int NoteCount;
  public int TagPoolSize;
  public int DateSpanDays;
  public int MaxTagsPerNote;
  public int LinkDensity;
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
  private const int MaxVisualLinksPerNote = 8;

  [Header("Injection")]
  [SerializeField] private bool injectSampleData = false;

  [Header("Sample graph")]
  [SerializeField] private SampleConnectionModel connectionModel = SampleConnectionModel.Random;
  [SerializeField] private SampleIslandMode islands = SampleIslandMode.Auto;
  [Min(0)]
  [SerializeField] private int noteCount = 320;
  [Min(0)]
  [SerializeField] private int tagPoolSize = 24;
  [Min(1)]
  [SerializeField] private int dateSpanDays = 720;
  [Range(0, 32)]
  [SerializeField] private int maxTagsPerNote = 3;
  [Range(0, 100)]
  [SerializeField] private int linkDensity = 1;

  public bool TryInjectSampleDataIfNeeded()
  {
    if (!injectSampleData || MapRuntimeContext.HasRuntimeNotes)
      return false;

    var settings = new SampleGraphSettings
    {
      ConnectionModel = connectionModel,
      Islands = islands,
      NoteCount = noteCount,
      TagPoolSize = tagPoolSize,
      DateSpanDays = dateSpanDays,
      MaxTagsPerNote = maxTagsPerNote,
      LinkDensity = linkDensity
    };

    var sampleGraph = GenerateGraph(settings, DateTime.Now.Date);
    MapRuntimeContext.SetTagNames(sampleGraph.TagNames);
    MapRuntimeContext.SetLinks(sampleGraph.Links);
    MapRuntimeContext.SetNotes(sampleGraph.Notes, string.Empty);

    Debug.Log(
      $"[CartographerSampleData] Injected connectionModel={settings.ConnectionModel} islands={settings.Islands} density={settings.LinkDensity} notes={sampleGraph.Notes.Count} tags={sampleGraph.TagNames.Count} links={sampleGraph.Links.Count}");
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
    settings.MaxTagsPerNote = Mathf.Clamp(settings.MaxTagsPerNote, 0, 32);
    settings.LinkDensity = Mathf.Clamp(settings.LinkDensity, 0, 100);
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

    if (settings.ConnectionModel == SampleConnectionModel.Clusters)
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
      if (settings.ConnectionModel == SampleConnectionModel.Clusters)
      {
        int clusterIndex = GetClusterIndex(i, clusterStarts, clusterSizes);
        tagPool = clusterTagPools[clusterIndex];
      }

      AssignTags(note, tagPool, GetEffectiveMaxTagsPerNote(settings), tagRng);
      notes.Add(note);
    }

    return notes;
  }

  private static int GetEffectiveMaxTagsPerNote(SampleGraphSettings settings)
  {
    if (settings.LinkDensity <= 0 || settings.MaxTagsPerNote <= 0)
      return 0;

    return Mathf.Clamp(
      Mathf.CeilToInt(settings.MaxTagsPerNote * (settings.LinkDensity / 100f)),
      1,
      settings.MaxTagsPerNote);
  }

  private static int BuildNoteLength(DateTime anchorDate, int noteIndex, SampleGraphSettings settings)
  {
    var rng = new System.Random(ComputeSeed(anchorDate, noteIndex, settings.NoteCount, (int)settings.ConnectionModel, 109));
    int scenarioBias = settings.ConnectionModel switch
    {
      SampleConnectionModel.Hubs => 3,
      SampleConnectionModel.Clusters => 5,
      SampleConnectionModel.SmallWorld => 2,
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
    if (notes == null || notes.Count < 2 || settings.LinkDensity <= 0)
      return links;

    var usedPairs = new HashSet<long>();
    int targetLinks = GetTargetLinkCount(settings, notes.Count);
    if (targetLinks <= 0)
      return links;

    var linkRng = new System.Random(ComputeSeed(anchorDate, settings.NoteCount, settings.LinkDensity, (int)settings.ConnectionModel, 73));

    if (settings.Islands == SampleIslandMode.One && settings.ConnectionModel != SampleConnectionModel.Chain)
      AddRandomTreeLinks(BuildSequentialIndices(notes.Count), targetLinks, linkRng, notes, links, usedPairs);

    switch (settings.ConnectionModel)
    {
      case SampleConnectionModel.Hubs:
        BuildHubLinks(settings, notes, targetLinks, linkRng, links, usedPairs);
        break;
      case SampleConnectionModel.Clusters:
        BuildClusterLinks(settings, notes, targetLinks, linkRng, links, usedPairs);
        break;
      case SampleConnectionModel.SmallWorld:
        BuildSmallWorldLinks(settings, notes, targetLinks, linkRng, links, usedPairs);
        break;
      case SampleConnectionModel.Chain:
        BuildChainLinks(settings, notes, targetLinks, links, usedPairs);
        break;
      default:
        BuildRandomLinks(settings, notes, targetLinks, linkRng, links, usedPairs);
        break;
    }

    return links;
  }

  private static void BuildRandomLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    int targetLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    int safety = targetLinks * 12 + 64;
    while (links.Count < targetLinks && safety-- > 0)
    {
      SelectRandomPair(settings, notes.Count, rng, out int sourceIndex, out int targetIndex);
      TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng));
    }
  }

  private static void BuildHubLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    int targetLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    if (settings.Islands == SampleIslandMode.Many)
    {
      BuildPartitionHubLinks(settings, notes, targetLinks, rng, links, usedPairs);
      return;
    }

    int hubCount = Math.Min(3, notes.Count);
    var hubs = new int[hubCount];
    for (int i = 0; i < hubCount; i++)
      hubs[i] = i;

    for (int hubOffset = 0; links.Count < targetLinks && hubOffset < hubCount; hubOffset++)
    {
      for (int noteIndex = 0; links.Count < targetLinks && noteIndex < notes.Count; noteIndex++)
        if (TryAddUniqueLink(noteIndex, hubs[hubOffset], notes, links, usedPairs, RandomWeight(rng)))
          continue;
    }

    int safety = targetLinks * 12 + 64;
    while (links.Count < targetLinks && safety-- > 0)
    {
      SelectRandomPair(settings, notes.Count, rng, out int sourceIndex, out int targetIndex);
      TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng));
    }
  }

  private static void BuildPartitionHubLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    int targetLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    int partitionCount = GetIslandPartitionCount(settings, notes.Count);
    BuildClusterLayout(notes.Count, partitionCount, out var starts, out var sizes);
    for (int partitionIndex = 0; links.Count < targetLinks && partitionIndex < partitionCount; partitionIndex++)
    {
      int start = starts[partitionIndex];
      int size = sizes[partitionIndex];
      int hubCount = Math.Min(3, size);
      for (int hubOffset = 0; links.Count < targetLinks && hubOffset < hubCount; hubOffset++)
      {
        int hubIndex = start + hubOffset;
        for (int noteIndex = start; links.Count < targetLinks && noteIndex < start + size; noteIndex++)
          TryAddUniqueLink(noteIndex, hubIndex, notes, links, usedPairs, RandomWeight(rng));
      }
    }

    int safety = targetLinks * 12 + 64;
    while (links.Count < targetLinks && safety-- > 0)
    {
      SelectRandomPair(settings, notes.Count, rng, out int sourceIndex, out int targetIndex);
      TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng));
    }
  }

  private static void BuildClusterLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    int targetLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    int clusterCount = GetClusterCount(settings);
    BuildClusterLayout(notes.Count, clusterCount, out var clusterStarts, out var clusterSizes);

    int safety = targetLinks * 12 + 64;
    while (links.Count < targetLinks && safety-- > 0)
    {
      int clusterIndex = rng.Next(0, clusterCount);
      int size = clusterSizes[clusterIndex];
      if (size < 2)
        continue;

      int start = clusterStarts[clusterIndex];
      int sourceIndex = start + rng.Next(0, size);
      int targetIndex = start + rng.Next(0, size);
      TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng));
    }
  }

  private static void BuildSmallWorldLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    int targetLinks,
    System.Random rng,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    int localWindow = Math.Max(2, notes.Count / 20);
    int safety = targetLinks * 12 + 64;
    while (links.Count < targetLinks && safety-- > 0)
    {
      int sourceIndex = rng.Next(0, notes.Count);
      int targetIndex;
      if (rng.NextDouble() < 0.8d)
      {
        int offset = rng.Next(1, localWindow + 1);
        targetIndex = rng.NextDouble() < 0.5d
          ? sourceIndex - offset
          : sourceIndex + offset;
        targetIndex = Mathf.Clamp(targetIndex, 0, notes.Count - 1);
      }
      else
      {
        targetIndex = rng.Next(0, notes.Count);
      }

      if (settings.Islands == SampleIslandMode.Many && !AreInSamePartition(sourceIndex, targetIndex, notes.Count, GetIslandPartitionCount(settings, notes.Count)))
        continue;

      TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, RandomWeight(rng));
    }
  }

  private static void BuildChainLinks(
    SampleGraphSettings settings,
    List<NoteData> notes,
    int targetLinks,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    if (settings.Islands == SampleIslandMode.Many)
    {
      int partitionCount = GetIslandPartitionCount(settings, notes.Count);
      BuildClusterLayout(notes.Count, partitionCount, out var starts, out var sizes);
      for (int partitionIndex = 0; links.Count < targetLinks && partitionIndex < partitionCount; partitionIndex++)
      {
        int start = starts[partitionIndex];
        int size = sizes[partitionIndex];
        for (int i = 0; links.Count < targetLinks && i < size - 1; i++)
          TryAddUniqueLink(start + i, start + i + 1, notes, links, usedPairs, 1f);
      }

      return;
    }

    for (int i = 0; links.Count < targetLinks && i < notes.Count - 1; i++)
      TryAddUniqueLink(i, i + 1, notes, links, usedPairs, 1f);
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
    return settings.ConnectionModel == SampleConnectionModel.Clusters
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

  private static int GetTargetLinkCount(SampleGraphSettings settings, int noteCount)
  {
    int maxLinks = GetMaxLinkCount(settings, noteCount);
    if (maxLinks <= 0 || settings.LinkDensity <= 0)
      return 0;

    int targetLinks = Mathf.RoundToInt(maxLinks * (settings.LinkDensity / 100f));
    targetLinks = Mathf.Clamp(targetLinks, 1, maxLinks);

    if (settings.Islands == SampleIslandMode.One && settings.ConnectionModel != SampleConnectionModel.Chain)
      targetLinks = Math.Min(GetMaxPairCount(noteCount), Math.Max(targetLinks, noteCount - 1));

    return targetLinks;
  }

  private static int GetMaxLinkCount(SampleGraphSettings settings, int noteCount)
  {
    if (noteCount < 2)
      return 0;

    if (settings.ConnectionModel == SampleConnectionModel.Chain)
      return GetMaxChainLinkCount(settings, noteCount);

    int visualLinkLimit = noteCount * MaxVisualLinksPerNote;
    if (settings.ConnectionModel == SampleConnectionModel.Clusters && settings.Islands != SampleIslandMode.One)
      return Math.Min(visualLinkLimit, GetClusterPairLimit(settings, noteCount));

    if (settings.Islands == SampleIslandMode.Many)
      return Math.Min(visualLinkLimit, GetPartitionPairLimit(settings, noteCount, GetIslandPartitionCount(settings, noteCount)));

    return Math.Min(visualLinkLimit, GetMaxPairCount(noteCount));
  }

  private static int GetMaxPairCount(int noteCount)
  {
    return (noteCount * (noteCount - 1)) / 2;
  }

  private static int GetMaxChainLinkCount(SampleGraphSettings settings, int noteCount)
  {
    if (settings.Islands != SampleIslandMode.Many)
      return noteCount - 1;

    int partitionCount = GetIslandPartitionCount(settings, noteCount);
    BuildClusterLayout(noteCount, partitionCount, out _, out var sizes);
    int maxLinks = 0;
    for (int i = 0; i < sizes.Length; i++)
      maxLinks += Math.Max(0, sizes[i] - 1);

    return maxLinks;
  }

  private static int GetClusterPairLimit(SampleGraphSettings settings, int noteCount)
  {
    int clusterCount = GetClusterCount(settings);
    return GetPartitionPairLimit(settings, noteCount, clusterCount);
  }

  private static int GetPartitionPairLimit(SampleGraphSettings settings, int noteCount, int partitionCount)
  {
    if (partitionCount <= 0)
      return 0;

    BuildClusterLayout(noteCount, partitionCount, out _, out var sizes);
    int maxLinks = 0;
    for (int i = 0; i < sizes.Length; i++)
      maxLinks += GetMaxPairCount(sizes[i]);

    return maxLinks;
  }

  private static List<int> BuildSequentialIndices(int count)
  {
    var indices = new List<int>(count);
    for (int i = 0; i < count; i++)
      indices.Add(i);

    return indices;
  }

  private static void AddRandomTreeLinks(
    List<int> sourceIndices,
    int targetLinks,
    System.Random rng,
    List<NoteData> notes,
    List<MapRuntimeContext.RuntimeNoteLink> links,
    HashSet<long> usedPairs)
  {
    if (sourceIndices == null || sourceIndices.Count < 2)
      return;

    var indices = new List<int>(sourceIndices);
    for (int i = indices.Count - 1; i > 0; i--)
    {
      int swapIndex = rng.Next(0, i + 1);
      (indices[i], indices[swapIndex]) = (indices[swapIndex], indices[i]);
    }

    for (int i = 1; links.Count < targetLinks && i < indices.Count; i++)
    {
      int sourceIndex = indices[i];
      int targetIndex = indices[rng.Next(0, i)];
      TryAddUniqueLink(sourceIndex, targetIndex, notes, links, usedPairs, 1f);
    }
  }

  private static void SelectRandomPair(
    SampleGraphSettings settings,
    int noteCount,
    System.Random rng,
    out int sourceIndex,
    out int targetIndex)
  {
    if (settings.Islands == SampleIslandMode.Many)
    {
      SelectRandomPairInPartition(noteCount, GetIslandPartitionCount(settings, noteCount), rng, out sourceIndex, out targetIndex);
      return;
    }

    sourceIndex = rng.Next(0, noteCount);
    targetIndex = rng.Next(0, noteCount);
  }

  private static void SelectRandomPairInPartition(
    int noteCount,
    int partitionCount,
    System.Random rng,
    out int sourceIndex,
    out int targetIndex)
  {
    BuildClusterLayout(noteCount, partitionCount, out var starts, out var sizes);
    int partitionIndex = rng.Next(0, partitionCount);
    int size = sizes[partitionIndex];
    if (size < 2)
    {
      sourceIndex = 0;
      targetIndex = 0;
      return;
    }

    int start = starts[partitionIndex];
    sourceIndex = start + rng.Next(0, size);
    targetIndex = start + rng.Next(0, size);
  }

  private static bool AreInSamePartition(int leftIndex, int rightIndex, int noteCount, int partitionCount)
  {
    return GetPartitionIndex(leftIndex, noteCount, partitionCount) == GetPartitionIndex(rightIndex, noteCount, partitionCount);
  }

  private static int GetPartitionIndex(int noteIndex, int noteCount, int partitionCount)
  {
    BuildClusterLayout(noteCount, partitionCount, out var starts, out var sizes);
    return GetClusterIndex(noteIndex, starts, sizes);
  }

  private static int GetIslandPartitionCount(SampleGraphSettings settings, int noteCount)
  {
    if (settings.ConnectionModel == SampleConnectionModel.Clusters)
      return GetClusterCount(settings);

    return Math.Min(4, noteCount);
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
