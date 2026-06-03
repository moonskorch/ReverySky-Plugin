using System.Collections.Generic;
using System.Reflection;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

public class ObsidianBridgeEditModeTests
{
  private GameObject bridgeObject;
  private ObsidianBridge bridge;
  private GameObject cartographerObject;

  [SetUp]
  public void SetUp()
  {
    ResetRuntimeContext();
    SetCartographerSingleton(null);
    bridgeObject = new GameObject("ObsidianBridgeEditModeTests");
    bridge = bridgeObject.AddComponent<ObsidianBridge>();
  }

  [TearDown]
  public void TearDown()
  {
    SetCartographerSingleton(null);
    if (cartographerObject != null)
      Object.DestroyImmediate(cartographerObject);

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
    Assert.That(noteOne.DateTime, Is.EqualTo(System.DateTime.Parse("2025-01-01T00:00:00Z", null, System.Globalization.DateTimeStyles.RoundtripKind)));
    Assert.That(noteTwo.DateTime, Is.EqualTo(System.DateTime.Parse("2025-01-02T00:00:00Z", null, System.Globalization.DateTimeStyles.RoundtripKind)));
    Assert.That(noteOne.Length, Is.EqualTo(42));
    Assert.That(noteTwo.Length, Is.EqualTo(0));
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
  public void OnGraphSet_TitleAndDateFallbacks_AreMappedPredictably()
  {
    bridge.OnGraphSet(TestPayloads.FallbacksPayload);

    NoteData titleFallback = MapRuntimeContext.FindNoteById("f1");
    NoteData noDate = MapRuntimeContext.FindNoteById("f2");

    Assert.That(titleFallback, Is.Not.Null);
    Assert.That(noDate, Is.Not.Null);
    Assert.That(titleFallback.Name, Is.EqualTo(GameSettings.DefaultTitle));
    Assert.That(titleFallback.DateTime, Is.EqualTo(System.DateTime.MinValue));
    Assert.That(noDate.DateTime, Is.EqualTo(System.DateTime.MinValue));
    Assert.That(titleFallback.Length, Is.EqualTo(0));
    Assert.That(noDate.Length, Is.EqualTo(5));
  }

  [Test]
  public void OnGraphSet_EnginePreference_MapsToRuntimeEnginePreference()
  {
    bridge.OnGraphSet(TestPayloads.EnginePreferenceForcesPayload);
    Assert.That(MapRuntimeContext.EnginePreference, Is.EqualTo(CartographerEngine.Forces));

    bridge.OnGraphSet(TestPayloads.EnginePreferenceStatic25DPayload);
    Assert.That(MapRuntimeContext.EnginePreference, Is.EqualTo(CartographerEngine.Static25D));

    bridge.OnGraphSet(TestPayloads.EnginePreferenceInvalidPayload);
    Assert.That(MapRuntimeContext.EnginePreference, Is.EqualTo(CartographerEngine.Auto));
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

  [Test]
  public void OnGraphSet_ProtocolMismatch_IsRejectedWithoutStateMutation()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring graph:set due to protocolVersion mismatch\\."));
    bridge.OnGraphSet(TestPayloads.ProtocolMismatchPayload);

    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));
  }

  [Test]
  public void OnGraphSet_TypeMismatch_IsRejectedWithoutStateMutation()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring graph:set due to message type mismatch\\."));
    bridge.OnGraphSet(TestPayloads.TypeMismatchPayload);

    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));
  }

  [Test]
  public void OnNoteFocus_WithId_SetsCurrentNoteIdWhenCartographerIsPresent()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();

    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo(string.Empty));

    bridge.OnNoteFocus(TestPayloads.NoteFocusByIdPayload);

    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo("a2"));
  }

  [Test]
  public void OnNoteFocus_WithPath_FallsBackToPathResolution()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();

    bridge.OnNoteFocus(TestPayloads.NoteFocusByPathPayload);

    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo("a2"));
  }

  [Test]
  public void OnNoteFocus_ProtocolMismatch_IsRejectedWithoutStateMutation()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();
    MapRuntimeContext.CurrentNoteId = "a1";

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring note:focus due to protocolVersion mismatch\\."));
    bridge.OnNoteFocus(TestPayloads.NoteFocusProtocolMismatchPayload);

    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo("a1"));
  }

  [Test]
  public void OnNoteFocus_TypeMismatch_IsRejectedWithoutStateMutation()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();
    MapRuntimeContext.CurrentNoteId = "a1";

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring note:focus due to message type mismatch\\."));
    bridge.OnNoteFocus(TestPayloads.NoteFocusTypeMismatchPayload);

    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo("a1"));
  }

  [Test]
  public void OnNoteFocus_EmptyAndInvalidPayload_AreHandledGracefully()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();
    MapRuntimeContext.CurrentNoteId = "a1";

    bridge.OnNoteFocus(TestPayloads.NoteFocusEmptyPayload);
    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo("a1"));

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Invalid note:focus payload:"));
    bridge.OnNoteFocus("{ invalid json");
    Assert.That(MapRuntimeContext.CurrentNoteId, Is.EqualTo("a1"));
  }

  private static void ResetRuntimeContext()
  {
    MapRuntimeContext.EnginePreference = CartographerEngine.Auto;
    MapRuntimeContext.CurrentNoteId = string.Empty;
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());
    MapRuntimeContext.SetNotes(new List<NoteData>());
  }

  private void EnsureCartographerSingleton()
  {
    cartographerObject = new GameObject("CartographerEditModeTests");
    Cartographer cartographer = cartographerObject.AddComponent<Cartographer>();
    SetCartographerSingleton(cartographer);
  }

  private static void SetCartographerSingleton(Cartographer value)
  {
    FieldInfo singletonBackingField =
      typeof(Cartographer).GetField("<I>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic);
    singletonBackingField?.SetValue(null, value);
  }

  private static class TestPayloads
  {
    public const string MinimalGraphSetPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"requestId\":\"req-minimal\",\"payload\":{\"graphVersion\":\"g1\",\"generatedAt\":\"2025-01-01T12:00:00Z\",\"vault\":{\"noteCount\":2},\"notes\":[" +
      "{\"id\":\"n1\",\"path\":\"a/n1.md\",\"title\":\"Note 1\",\"tags\":[\"alpha\",\"beta\"],\"date\":\"2025-01-01T00:00:00Z\",\"size\":42,\"unknown\":\"ignored\"}," +
      "{\"id\":\"n2\",\"path\":\"a/n2.md\",\"title\":\"Note 2\",\"tags\":[\"beta\",\"gamma\"],\"date\":\"2025-01-02T00:00:00Z\",\"size\":-5}" +
      "],\"links\":[" +
      "{\"sourceId\":\"n1\",\"targetId\":\"n2\",\"weight\":0}," +
      "{\"sourceId\":\"n1\",\"targetId\":\"n1\",\"weight\":2}," +
      "{\"sourceId\":\"\",\"targetId\":\"n2\",\"weight\":3}" +
      "]}}";

    public const string RepeatApplyPayloadA =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"a1\",\"path\":\"x/a1.md\",\"title\":\"A1\",\"tags\":[\"one\"],\"date\":\"2025-01-01T00:00:00Z\",\"size\":10}," +
      "{\"id\":\"a2\",\"path\":\"x/a2.md\",\"title\":\"A2\",\"tags\":[\"two\"],\"date\":\"2025-01-02T00:00:00Z\",\"size\":20}," +
      "{\"id\":\"a3\",\"path\":\"x/a3.md\",\"title\":\"A3\",\"tags\":[\"three\"],\"date\":\"2025-01-03T00:00:00Z\",\"size\":30}" +
      "],\"links\":[" +
      "{\"sourceId\":\"a1\",\"targetId\":\"a2\",\"weight\":1}," +
      "{\"sourceId\":\"a2\",\"targetId\":\"a3\",\"weight\":2}" +
      "]}}";

    public const string RepeatApplyPayloadB =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"b1\",\"path\":\"y/b1.md\",\"title\":\"B1\",\"tags\":[\"solo\"],\"date\":\"2025-02-01T00:00:00Z\",\"size\":15}" +
      "],\"links\":[]}}";

    public const string FallbacksPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"f1\",\"path\":\"fallback/f1.md\",\"title\":\"   \",\"tags\":[],\"date\":\"not-an-iso-date\",\"size\":-11}," +
      "{\"id\":\"f2\",\"path\":\"fallback/f2.md\",\"tags\":[\"solo\"],\"size\":5}" +
      "],\"links\":[]}}";

    public const string EnginePreferenceForcesPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"enginePreference\":\"forces\",\"notes\":[" +
      "{\"id\":\"e1\",\"path\":\"engine/forces.md\",\"title\":\"Forces\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string EnginePreferenceStatic25DPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"enginePreference\":\"static25d\",\"notes\":[" +
      "{\"id\":\"e2\",\"path\":\"engine/static25d.md\",\"title\":\"Static25D\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string EnginePreferenceInvalidPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"enginePreference\":\"unsupported\",\"notes\":[" +
      "{\"id\":\"e3\",\"path\":\"engine/auto.md\",\"title\":\"Auto\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string NoteFocusByIdPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:focus\",\"payload\":{\"id\":\"a2\"}}";

    public const string NoteFocusByPathPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:focus\",\"payload\":{\"path\":\"X\\\\A2.md\"}}";

    public const string NoteFocusEmptyPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:focus\",\"payload\":{}}";

    public const string NoteFocusProtocolMismatchPayload =
      "{\"protocolVersion\":\"9.9.9\",\"type\":\"note:focus\",\"payload\":{\"id\":\"a2\"}}";

    public const string NoteFocusTypeMismatchPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:open\",\"payload\":{\"id\":\"a2\"}}";

    public const string ProtocolMismatchPayload =
      "{\"protocolVersion\":\"9.9.9\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"m1\",\"path\":\"mismatch/protocol.md\",\"title\":\"Mismatch Protocol\",\"tags\":[\"one\"],\"date\":\"2025-03-01T00:00:00Z\",\"size\":10}" +
      "],\"links\":[]}}";

    public const string TypeMismatchPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"m2\",\"path\":\"mismatch/type.md\",\"title\":\"Mismatch Type\",\"tags\":[\"one\"],\"date\":\"2025-03-01T00:00:00Z\",\"size\":20}" +
      "],\"links\":[]}}";
  }
}
