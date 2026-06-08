using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

public class SampleDataGeneratorEditModeTests
{
  private static readonly DateTime AnchorDate = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

  [Test]
  public void GenerateGraph_IsDeterministic_ForIdenticalInputs()
  {
    var settings = new SampleGraphSettings
    {
      Scenario = SampleGraphScenario.Normal,
      NoteCount = 30,
      TagPoolSize = 8,
      DateSpanDays = 720,
      MaxTagsPerNote = 3,
      ExtraLinks = 20
    };

    SampleGraphData first = SampleDataGenerator.GenerateGraph(settings, AnchorDate);
    SampleGraphData second = SampleDataGenerator.GenerateGraph(settings, AnchorDate);

    AssertGraphsEqual(first, second);
    Assert.That(first.Notes.Select(note => note.Length).Distinct().Count(), Is.GreaterThan(1));
  }

  [TestCase(0)]
  [TestCase(1)]
  [TestCase(10000)]
  public void GenerateGraph_RespectsBoundaryNoteCounts(int noteCount)
  {
    var settings = new SampleGraphSettings
    {
      Scenario = SampleGraphScenario.Normal,
      NoteCount = noteCount,
      TagPoolSize = 8,
      DateSpanDays = 720,
      MaxTagsPerNote = 3,
      ExtraLinks = 0
    };

    SampleGraphData result = SampleDataGenerator.GenerateGraph(settings, AnchorDate);

    Assert.That(result.Notes.Count, Is.EqualTo(noteCount));
    if (noteCount <= 1)
      Assert.That(result.Links.Count, Is.EqualTo(0));
  }

  [TestCase(SampleGraphScenario.Normal)]
  [TestCase(SampleGraphScenario.Hub)]
  [TestCase(SampleGraphScenario.Clusters)]
  public void GenerateGraph_ProducesValidInvariants_ForAllScenarios(SampleGraphScenario scenario)
  {
    var settings = new SampleGraphSettings
    {
      Scenario = scenario,
      NoteCount = 50,
      TagPoolSize = 12,
      DateSpanDays = 720,
      MaxTagsPerNote = 3,
      ExtraLinks = 60
    };

    SampleGraphData result = SampleDataGenerator.GenerateGraph(settings, AnchorDate);
    AssertGraphInvariants(result);
  }

  [TestCase(0, 8)]
  [TestCase(2, 8)]
  public void GenerateGraph_ClampsTagPoolSafely(int tagPoolSize, int maxTagsPerNote)
  {
    var settings = new SampleGraphSettings
    {
      Scenario = SampleGraphScenario.Normal,
      NoteCount = 25,
      TagPoolSize = tagPoolSize,
      DateSpanDays = 720,
      MaxTagsPerNote = maxTagsPerNote,
      ExtraLinks = 0
    };

    SampleGraphData result = SampleDataGenerator.GenerateGraph(settings, AnchorDate);

    foreach (NoteData note in result.Notes)
    {
      Assert.That(note.TagIds.Count, Is.LessThanOrEqualTo(tagPoolSize));
      Assert.That(note.TagIds.Count, Is.LessThanOrEqualTo(8));
      Assert.That(note.TagIds.Distinct().Count(), Is.EqualTo(note.TagIds.Count));
      Assert.That(note.TagIds.All(tagId => result.TagNames.ContainsKey(tagId)), Is.True);
    }
  }

  [Test]
  public void GenerateGraph_HubScenario_CreatesVisibleHubs()
  {
    var settings = new SampleGraphSettings
    {
      Scenario = SampleGraphScenario.Hub,
      NoteCount = 100,
      TagPoolSize = 12,
      DateSpanDays = 720,
      MaxTagsPerNote = 3,
      ExtraLinks = 150
    };

    SampleGraphData result = SampleDataGenerator.GenerateGraph(settings, AnchorDate);
    var degrees = BuildUndirectedDegrees(result);
    int maxDegree = degrees.Values.Max();

    Assert.That(maxDegree, Is.GreaterThanOrEqualTo(20));
  }

  [Test]
  public void GenerateGraph_ClustersScenario_KeepsLinksAndTagsLocal()
  {
    var settings = new SampleGraphSettings
    {
      Scenario = SampleGraphScenario.Clusters,
      NoteCount = 40,
      TagPoolSize = 12,
      DateSpanDays = 720,
      MaxTagsPerNote = 3,
      ExtraLinks = 60
    };

    SampleGraphData result = SampleDataGenerator.GenerateGraph(settings, AnchorDate);
    int clusterCount = Math.Min(4, settings.NoteCount);
    int[] clusterStarts;
    int[] clusterSizes;
    BuildClusterLayout(settings.NoteCount, clusterCount, out clusterStarts, out clusterSizes);
    var notesById = result.Notes.Select((note, index) => new { note, index }).ToDictionary(x => x.note.Id, x => x.index);
    var tagOwners = new Dictionary<int, int>();

    foreach (MapRuntimeContext.RuntimeNoteLink link in result.Links)
    {
      int sourceIndex = notesById[link.SourceId];
      int targetIndex = notesById[link.TargetId];
      Assert.That(GetClusterIndex(sourceIndex, clusterStarts, clusterSizes), Is.EqualTo(GetClusterIndex(targetIndex, clusterStarts, clusterSizes)));
    }

    for (int i = 0; i < result.Notes.Count; i++)
    {
      int clusterIndex = GetClusterIndex(i, clusterStarts, clusterSizes);
      foreach (int tagId in result.Notes[i].TagIds)
      {
        if (tagOwners.TryGetValue(tagId, out int ownerCluster))
        {
          Assert.That(ownerCluster, Is.EqualTo(clusterIndex));
        }
        else
        {
          tagOwners[tagId] = clusterIndex;
        }
      }
    }
  }

  private static void AssertGraphsEqual(SampleGraphData expected, SampleGraphData actual)
  {
    Assert.That(actual.Notes.Count, Is.EqualTo(expected.Notes.Count));
    for (int i = 0; i < expected.Notes.Count; i++)
    {
      NoteData left = expected.Notes[i];
      NoteData right = actual.Notes[i];
      Assert.That(right.Id, Is.EqualTo(left.Id), $"Note id mismatch at index {i}");
      Assert.That(right.Path, Is.EqualTo(left.Path), $"Note path mismatch at index {i}");
      Assert.That(right.DateTime, Is.EqualTo(left.DateTime), $"Note date mismatch at index {i}");
      Assert.That(right.Length, Is.EqualTo(left.Length), $"Note length mismatch at index {i}");
      Assert.That(right.SphereType, Is.EqualTo(SphereType.Unknown), $"Note sphere type should stay production-like at index {i}");
      Assert.That(right.SphereType, Is.EqualTo(left.SphereType), $"Note sphere mismatch at index {i}");
      Assert.That(right.TagIds, Is.EqualTo(left.TagIds), $"Tag assignment mismatch at index {i}");
    }

    Assert.That(actual.TagNames.Count, Is.EqualTo(expected.TagNames.Count));
    var expectedTags = expected.TagNames.OrderBy(pair => pair.Key).ToArray();
    var actualTags = actual.TagNames.OrderBy(pair => pair.Key).ToArray();
    for (int i = 0; i < expectedTags.Length; i++)
    {
      Assert.That(actualTags[i].Key, Is.EqualTo(expectedTags[i].Key), $"Tag id mismatch at index {i}");
      Assert.That(actualTags[i].Value, Is.EqualTo(expectedTags[i].Value), $"Tag name mismatch at index {i}");
    }

    Assert.That(actual.Links.Count, Is.EqualTo(expected.Links.Count));
    for (int i = 0; i < expected.Links.Count; i++)
    {
      MapRuntimeContext.RuntimeNoteLink left = expected.Links[i];
      MapRuntimeContext.RuntimeNoteLink right = actual.Links[i];
      Assert.That(right.SourceId, Is.EqualTo(left.SourceId), $"Link source mismatch at index {i}");
      Assert.That(right.TargetId, Is.EqualTo(left.TargetId), $"Link target mismatch at index {i}");
      Assert.That(right.Weight, Is.EqualTo(left.Weight), $"Link weight mismatch at index {i}");
    }
  }

  private static void AssertGraphInvariants(SampleGraphData result)
  {
    var noteIds = new HashSet<string>();
    var notePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var noteIdSet = new HashSet<string>(result.Notes.Select(note => note.Id));
    var tagIds = new HashSet<int>(result.TagNames.Keys);
    var linkPairs = new HashSet<string>();

    foreach (NoteData note in result.Notes)
    {
      Assert.That(noteIds.Add(note.Id), Is.True, $"Duplicate note id: {note.Id}");
      Assert.That(notePaths.Add(note.Path), Is.True, $"Duplicate note path: {note.Path}");
      Assert.That(note.Length, Is.GreaterThan(0), $"Note length must be positive: {note.Id}");
      foreach (int tagId in note.TagIds)
        Assert.That(tagIds.Contains(tagId), Is.True, $"Unknown tag id: {tagId}");
    }

    foreach (MapRuntimeContext.RuntimeNoteLink link in result.Links)
    {
      Assert.That(noteIdSet.Contains(link.SourceId), Is.True, $"Missing source note: {link.SourceId}");
      Assert.That(noteIdSet.Contains(link.TargetId), Is.True, $"Missing target note: {link.TargetId}");
      Assert.That(link.SourceId, Is.Not.EqualTo(link.TargetId), "Self-link detected");
      Assert.That(link.Weight, Is.GreaterThan(0f), "Link weight must be positive");

      string pairKey = MakeUndirectedPairKey(link.SourceId, link.TargetId);
      Assert.That(linkPairs.Add(pairKey), Is.True, $"Duplicate undirected link: {pairKey}");
    }
  }

  private static Dictionary<string, int> BuildUndirectedDegrees(SampleGraphData result)
  {
    var degrees = result.Notes.ToDictionary(note => note.Id, _ => 0);
    foreach (MapRuntimeContext.RuntimeNoteLink link in result.Links)
    {
      degrees[link.SourceId]++;
      degrees[link.TargetId]++;
    }

    return degrees;
  }

  private static void BuildClusterLayout(
    int noteCount,
    int clusterCount,
    out int[] clusterStarts,
    out int[] clusterSizes)
  {
    clusterStarts = new int[clusterCount];
    clusterSizes = new int[clusterCount];
    if (clusterCount <= 0)
      return;

    int baseSize = noteCount / clusterCount;
    int remainder = noteCount % clusterCount;
    int cursor = 0;
    for (int i = 0; i < clusterCount; i++)
    {
      clusterStarts[i] = cursor;
      clusterSizes[i] = baseSize + (i < remainder ? 1 : 0);
      cursor += clusterSizes[i];
    }
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

  private static string MakeUndirectedPairKey(string a, string b)
  {
    return string.CompareOrdinal(a, b) <= 0 ? $"{a}|{b}" : $"{b}|{a}";
  }
}
