using System.Collections.Generic;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

public class ObsidianBridgeEditModeTests
{
  private GameObject bridgeObject;
  private ObsidianBridge bridge;

  [SetUp]
  public void SetUp()
  {
    ResetRuntimeContext();
    bridgeObject = new GameObject("ObsidianBridgeEditModeTests");
    bridge = bridgeObject.AddComponent<ObsidianBridge>();
  }

  [TearDown]
  public void TearDown()
  {
    if (bridgeObject != null)
      Object.DestroyImmediate(bridgeObject);
  }

  [Test]
  public void OnGraphSet_MinimalPayload_MapsRuntimeStateAndNormalizesWeight()
  {
    bridge.OnGraphSet(TestPayloads.MinimalGraphSetPayload);

    Assert.That(MapRuntimeContext.IsRuntimeMode, Is.True);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(2));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(1));
    Assert.That(MapRuntimeContext.Links[0].SourceId, Is.EqualTo("n1"));
    Assert.That(MapRuntimeContext.Links[0].TargetId, Is.EqualTo("n2"));
    Assert.That(MapRuntimeContext.Links[0].Weight, Is.EqualTo(1f));

    NoteData noteOne = MapRuntimeContext.FindNoteById("n1");
    NoteData noteTwo = MapRuntimeContext.FindNoteById("n2");

    Assert.That(noteOne, Is.Not.Null);
    Assert.That(noteTwo, Is.Not.Null);
    Assert.That(noteOne.TagIds, Has.Count.EqualTo(2));
    Assert.That(noteTwo.TagIds, Has.Count.EqualTo(2));
    Assert.That(noteOne.TagIds[1], Is.EqualTo(noteTwo.TagIds[0]));

    int alphaTagId = noteOne.TagIds[0];
    int betaTagId = noteOne.TagIds[1];
    int gammaTagId = noteTwo.TagIds[1];
    Assert.That(MapRuntimeContext.GetTagName(alphaTagId), Is.EqualTo("alpha"));
    Assert.That(MapRuntimeContext.GetTagName(betaTagId), Is.EqualTo("beta"));
    Assert.That(MapRuntimeContext.GetTagName(gammaTagId), Is.EqualTo("gamma"));
  }

  [Test]
  public void OnGraphSet_RepeatApply_ReplacesPreviousStateWithoutStaleData()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));

    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadB);

    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(1));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(0));
    Assert.That(MapRuntimeContext.FindNoteById("a2"), Is.Null);
    Assert.That(MapRuntimeContext.FindNoteById("a3"), Is.Null);
    Assert.That(MapRuntimeContext.FindNoteById("b1"), Is.Not.Null);
    Assert.That(MapRuntimeContext.GetTagName(2), Is.Null);
  }

  [Test]
  public void OnGraphSet_EmptyAndInvalidPayload_AreHandledGracefully()
  {
    bridge.OnGraphSet(string.Empty);

    Assert.That(MapRuntimeContext.IsRuntimeMode, Is.True);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(0));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(0));

    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));

    LogAssert.Expect(LogType.Error, new Regex("\\[ObsidianBridge\\] Invalid graph:set payload:"));
    bridge.OnGraphSet("{ invalid json");

    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));
  }

  private static void ResetRuntimeContext()
  {
    MapRuntimeContext.FilterRangeDays = 0;
    MapRuntimeContext.FilterImportance = CrystalType.Unknown;
    MapRuntimeContext.FilterEngine = CartographerEngine.Auto;
    MapRuntimeContext.CurrentNoteId = string.Empty;
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());
    MapRuntimeContext.SetNotes(new List<NoteData>());
  }

  private static class TestPayloads
  {
    public const string MinimalGraphSetPayload =
      "{\"protocolVersion\":\"1.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"n1\",\"path\":\"a/n1.md\",\"title\":\"Note 1\",\"tags\":[\"alpha\",\"beta\"],\"dates\":{\"noteDate\":\"2025-01-01T00:00:00Z\"}}," +
      "{\"id\":\"n2\",\"path\":\"a/n2.md\",\"title\":\"Note 2\",\"tags\":[\"beta\",\"gamma\"],\"dates\":{\"created\":\"2025-01-02T00:00:00Z\"}}" +
      "],\"links\":[" +
      "{\"sourceId\":\"n1\",\"targetId\":\"n2\",\"weight\":0}," +
      "{\"sourceId\":\"n1\",\"targetId\":\"n1\",\"weight\":2}" +
      "]}}";

    public const string RepeatApplyPayloadA =
      "{\"protocolVersion\":\"1.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"a1\",\"path\":\"x/a1.md\",\"title\":\"A1\",\"tags\":[\"one\"],\"dates\":{\"created\":\"2025-01-01T00:00:00Z\"}}," +
      "{\"id\":\"a2\",\"path\":\"x/a2.md\",\"title\":\"A2\",\"tags\":[\"two\"],\"dates\":{\"created\":\"2025-01-02T00:00:00Z\"}}," +
      "{\"id\":\"a3\",\"path\":\"x/a3.md\",\"title\":\"A3\",\"tags\":[\"three\"],\"dates\":{\"created\":\"2025-01-03T00:00:00Z\"}}" +
      "],\"links\":[" +
      "{\"sourceId\":\"a1\",\"targetId\":\"a2\",\"weight\":1}," +
      "{\"sourceId\":\"a2\",\"targetId\":\"a3\",\"weight\":2}" +
      "]}}";

    public const string RepeatApplyPayloadB =
      "{\"protocolVersion\":\"1.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"b1\",\"path\":\"y/b1.md\",\"title\":\"B1\",\"tags\":[\"solo\"],\"dates\":{\"created\":\"2025-02-01T00:00:00Z\"}}" +
      "],\"links\":[]}}";
  }
}
