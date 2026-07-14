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
    Assert.That(noteOne.DirectLinkCount, Is.EqualTo(1));
    Assert.That(noteTwo.DirectLinkCount, Is.EqualTo(1));
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
  public void OnGraphSet_DirectLinkCount_UsesUniqueRuntimeNoteNeighbors()
  {
    bridge.OnGraphSet(TestPayloads.DirectLinkCountPayload);

    Assert.That(MapRuntimeContext.FindNoteById("n1")?.DirectLinkCount, Is.EqualTo(2));
    Assert.That(MapRuntimeContext.FindNoteById("n2")?.DirectLinkCount, Is.EqualTo(1));
    Assert.That(MapRuntimeContext.FindNoteById("n3")?.DirectLinkCount, Is.EqualTo(1));
    Assert.That(MapRuntimeContext.FindNoteById("n4")?.DirectLinkCount, Is.EqualTo(0));
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
  public void OnGraphSet_LayoutPreference_MapsToRuntimeLayoutPreference()
  {
    bridge.OnGraphSet(TestPayloads.LayoutPreferenceDynamicLinksPayload);
    Assert.That(MapRuntimeContext.MapLayoutPreference, Is.EqualTo(MapLayoutMode.DynamicLinks));

    bridge.OnGraphSet(TestPayloads.LayoutPreferenceDatesPayload);
    Assert.That(MapRuntimeContext.MapLayoutPreference, Is.EqualTo(MapLayoutMode.Dates));

    bridge.OnGraphSet(TestPayloads.LayoutPreferenceScalableLinksPayload);
    Assert.That(MapRuntimeContext.MapLayoutPreference, Is.EqualTo(MapLayoutMode.ScalableLinks));

    bridge.OnGraphSet(TestPayloads.LayoutPreferenceInvalidPayload);
    Assert.That(MapRuntimeContext.MapLayoutPreference, Is.EqualTo(MapLayoutMode.Auto));
  }

  [Test]
  public void ApplyGraphFocus_UsesPendingThenRestoreAndResetsWhenMissing()
  {
    var cartographerObject = new GameObject("CartographerResolveFocusTests");
    var focusObject = new GameObject("CartographerResolveFocusNodeTests");
    var cameraObject = new GameObject("CartographerResolveFocusCameraTests");
    var startObject = new GameObject("CartographerResolveFocusCameraStartTests");
    var starObject = new GameObject("CartographerResolveFocusStarTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var focusNode = focusObject.AddComponent<FocusNode>();
      var cameraController = cameraObject.AddComponent<CameraOrbitalController>();
      var restoreStar = starObject.AddComponent<Star>();
      restoreStar.SetData(new NoteData { Id = "old", Path = "notes/old.md" });
      SetCartographerSingleton(cartographer);
      FieldInfo focusField = typeof(Cartographer).GetField("focusNode", BindingFlags.Instance | BindingFlags.NonPublic);
      FieldInfo cameraField = typeof(FocusNode).GetField("cameraController", BindingFlags.Instance | BindingFlags.NonPublic);
      MethodInfo applyGraphFocus = typeof(Cartographer).GetMethod("ApplyGraphFocus", BindingFlags.Instance | BindingFlags.NonPublic);

      Assert.That(focusField, Is.Not.Null);
      Assert.That(cameraField, Is.Not.Null);
      Assert.That(applyGraphFocus, Is.Not.Null);

      focusField.SetValue(cartographer, focusNode);
      cameraField.SetValue(focusNode, cameraController);
      focusNode.FocusRestoreNoteId = "old";
      SetPrivateField(
        cartographer,
        "<GraphIndex>k__BackingField",
        MapGraphIndex.Build(
          new List<Star> { restoreStar },
          new List<TagNode>(),
          new List<MapRuntimeContext.RuntimeNoteLink>()));

      MapRuntimeContext.PendingFocusNoteId = "old";
      applyGraphFocus.Invoke(cartographer, null);
      Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo(string.Empty));

      MapRuntimeContext.PendingFocusNoteId = string.Empty;
      focusNode.FocusRestoreNoteId = "missing";
      var unchangedCameraTarget = new Vector3(4f, 5f, 6f);
      var resetCameraTarget = new Vector3(8f, 0f, 9f);
      SetPrivateField(cameraController, "targetPos", unchangedCameraTarget);
      startObject.transform.position = new Vector3(resetCameraTarget.x, 3f, resetCameraTarget.z);
      SetPrivateField(cameraController, "startPosition", startObject.transform);
      applyGraphFocus.Invoke(cartographer, null);
      Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo(string.Empty));
      Assert.That(focusNode.FocusRestoreNoteId, Is.EqualTo("missing"));
      Assert.That(GetPrivateField<Vector3>(cameraController, "targetPos"), Is.EqualTo(resetCameraTarget));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(focusObject);
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(startObject);
      Object.DestroyImmediate(starObject);
    }
  }

  [Test]
  public void BuildGraph_EmptyNotes_ClearsStaleGraphIndex()
  {
    var cartographerObject = new GameObject("CartographerEmptyGraphIndexTests");
    var focusObject = new GameObject("CartographerEmptyGraphIndexTests_Focus");
    var cameraObject = new GameObject("CartographerEmptyGraphIndexTests_Camera");
    var staleStarObject = new GameObject("CartographerEmptyGraphIndexTests_StaleStar");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var focusNode = focusObject.AddComponent<FocusNode>();
      var cameraController = cameraObject.AddComponent<CameraOrbitalController>();
      var staleStar = staleStarObject.AddComponent<Star>();
      staleStar.SetData(new NoteData { Id = "stale", Path = "notes/stale.md" });
      MapGraphIndex staleIndex = MapGraphIndex.Build(
        new List<Star> { staleStar },
        new List<TagNode>(),
        new List<MapRuntimeContext.RuntimeNoteLink>());

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "focusNode", focusNode);
      SetPrivateField(focusNode, "cameraController", cameraController);
      SetPrivateField(cartographer, "_dynamicLinksEngine", new TestCartographerEngine(MapLayoutMode.DynamicLinks));
      SetPrivateField(cartographer, "<GraphIndex>k__BackingField", staleIndex);

      Assert.That(cartographer.GraphIndex.TryGetStar("stale", out _), Is.True);

      MethodInfo buildGraph = typeof(Cartographer).GetMethod("BuildGraph", BindingFlags.Instance | BindingFlags.NonPublic);
      Assert.That(buildGraph, Is.Not.Null);

      buildGraph.Invoke(cartographer, new object[] { new List<NoteData>(), MapLayoutMode.DynamicLinks });

      Assert.That(cartographer.GraphIndex.Nodes, Is.Empty);
      Assert.That(cartographer.GraphIndex.TryGetStar("stale", out _), Is.False);
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(focusObject);
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(staleStarObject);
    }
  }

  [TestCase(MapLayoutMode.DynamicLinks)]
  [TestCase(MapLayoutMode.ScalableLinks)]
  [TestCase(MapLayoutMode.Dates)]
  public void Focus_AlwaysStaysOnEquatorAndPreservesYawFallback(MapLayoutMode engineType)
  {
    var cartographerObject = new GameObject("CameraFocusCartographerTests");
    var pivotObject = new GameObject("CameraFocusPivotTests");
    var cameraObject = new GameObject("CameraFocusControllerTests");
    try
    {
      SetCartographerSingleton(null);

      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var cameraController = cameraObject.AddComponent<CameraOrbitalController>();
      var pivot = pivotObject.transform;
      var activeEngine = new TestCartographerEngine(engineType);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_activeEngine", activeEngine);

      pivot.position = new Vector3(3f, 5f, -2f);
      cameraController.transform.position = new Vector3(3f, 13f, -2f);
      cameraController.SetActivePivot(pivot);
      SetPrivateField(cameraController, "targetPos", new Vector3(3f, 9f, -2f));
      SetPrivateField(cameraController, "orbitYaw", 37f);

      cameraController.Focus(pivot.position, 6f);

      Vector3 storedTargetPos = GetPrivateField<Vector3>(cameraController, "targetPos");
      float orbitHeight = GetPrivateField<float>(cameraController, "orbitHeight");
      float orbitYaw = GetPrivateField<float>(cameraController, "orbitYaw");
      Vector3 expectedDirection = Quaternion.Euler(0f, 37f, 0f) * Vector3.forward;
      Vector3 expectedTargetPos = pivot.position + expectedDirection * 6f;

      Assert.That(storedTargetPos.y, Is.EqualTo(pivot.position.y).Within(0.0001f));
      Assert.That(storedTargetPos.x, Is.EqualTo(expectedTargetPos.x).Within(0.0001f));
      Assert.That(storedTargetPos.z, Is.EqualTo(expectedTargetPos.z).Within(0.0001f));
      Assert.That(orbitHeight, Is.EqualTo(0f).Within(0.0001f));
      Assert.That(orbitYaw, Is.EqualTo(37f).Within(0.0001f));
    }
    finally
    {
      SetCartographerSingleton(null);

      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(pivotObject);
      Object.DestroyImmediate(cameraObject);
    }
  }

  [TestCase(MapLayoutMode.DynamicLinks)]
  [TestCase(MapLayoutMode.ScalableLinks)]
  [TestCase(MapLayoutMode.Dates)]
  public void ResetToStart_FlattensStartPositionToActivePivotEquator(MapLayoutMode engineType)
  {
    var cartographerObject = new GameObject("CameraResetCartographerTests");
    var cameraObject = new GameObject("CameraResetControllerTests");
    var startObject = new GameObject("CameraResetStartTests");
    try
    {
      SetCartographerSingleton(null);

      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var cameraController = cameraObject.AddComponent<CameraOrbitalController>();
      var pivot = new Vector3(3f, 25f, 4f);
      var activeEngine = new TestCartographerEngine(engineType, pivot);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_activeEngine", activeEngine);

      startObject.transform.position = new Vector3(0f, -9f, -20f);
      SetPrivateField(cameraController, "startPosition", startObject.transform);

      cameraController.ResetToStart();

      Vector3 storedTargetPos = GetPrivateField<Vector3>(cameraController, "targetPos");
      float orbitHeight = GetPrivateField<float>(cameraController, "orbitHeight");

      Assert.That(storedTargetPos.y, Is.EqualTo(pivot.y).Within(0.0001f));
      Assert.That(orbitHeight, Is.EqualTo(0f).Within(0.0001f));
    }
    finally
    {
      SetCartographerSingleton(null);

      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(startObject);
    }
  }

  [Test]
  public void ResolveModeByNotesCount_UsesScalableLinksForLargeAutoAndDynamicLinksGraphs()
  {
    var cartographerObject = new GameObject("CartographerResolveModeTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var resolveMode = typeof(Cartographer).GetMethod("ResolveModeByNotesCount", BindingFlags.Instance | BindingFlags.NonPublic);

      Assert.That(resolveMode, Is.Not.Null);

      var autoLarge = (MapLayoutMode)resolveMode.Invoke(cartographer, new object[] { 501, MapLayoutMode.Auto });
      var dynamicLinksLarge = (MapLayoutMode)resolveMode.Invoke(cartographer, new object[] { 501, MapLayoutMode.DynamicLinks });
      var dynamicLinksSmall = (MapLayoutMode)resolveMode.Invoke(cartographer, new object[] { 500, MapLayoutMode.DynamicLinks });

      Assert.That(autoLarge, Is.EqualTo(MapLayoutMode.ScalableLinks));
      Assert.That(dynamicLinksLarge, Is.EqualTo(MapLayoutMode.ScalableLinks));
      Assert.That(dynamicLinksSmall, Is.EqualTo(MapLayoutMode.DynamicLinks));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
    }
  }

  [Test]
  public void ResolveModeByNotesCount_KeepsExplicitDatesAndScalableLinksPreferences()
  {
    var cartographerObject = new GameObject("CartographerResolveExplicitModeTests");
    var datesEngineObject = new GameObject("CartographerResolveExplicitDatesTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var datesEngine = datesEngineObject.AddComponent<Cartographer25DEngine>();
      var resolveMode = typeof(Cartographer).GetMethod("ResolveModeByNotesCount", BindingFlags.Instance | BindingFlags.NonPublic);
      FieldInfo datesEngineField = typeof(Cartographer).GetField("_datesEngine", BindingFlags.Instance | BindingFlags.NonPublic);

      Assert.That(resolveMode, Is.Not.Null);
      Assert.That(datesEngineField, Is.Not.Null);

      datesEngineField.SetValue(cartographer, datesEngine);

      var dates = (MapLayoutMode)resolveMode.Invoke(cartographer, new object[] { 1, MapLayoutMode.Dates });
      var scalableLinks = (MapLayoutMode)resolveMode.Invoke(cartographer, new object[] { 1, MapLayoutMode.ScalableLinks });

      Assert.That(dates, Is.EqualTo(cartographer.Static25DEngine.EngineType));
      Assert.That(scalableLinks, Is.EqualTo(MapLayoutMode.ScalableLinks));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(datesEngineObject);
    }
  }

  [Test]
  public void StarVisual_ResolveCrystalTypeByDirectLinkCount_MapsExpectedBuckets()
  {
    MethodInfo resolver = typeof(StarVisual).GetMethod(
      "ResolveCrystalTypeByDirectLinkCount",
      BindingFlags.Static | BindingFlags.NonPublic);

    Assert.That(resolver, Is.Not.Null);
    Assert.That(ResolveCrystalType(resolver, -1), Is.EqualTo(CrystalType.Value1));
    Assert.That(ResolveCrystalType(resolver, 0), Is.EqualTo(CrystalType.Value1));
    Assert.That(ResolveCrystalType(resolver, 1), Is.EqualTo(CrystalType.Value2));
    Assert.That(ResolveCrystalType(resolver, 2), Is.EqualTo(CrystalType.Value3));
    Assert.That(ResolveCrystalType(resolver, 10), Is.EqualTo(CrystalType.Value3));
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
  public void OnGraphSet_MalformedNotes_SkipsNotesWithoutRequiredIdentityFields()
  {
    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Skipping graph note with missing id or path\\."));
    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Skipping graph note with missing id or path\\."));

    bridge.OnGraphSet(TestPayloads.MalformedNotesPayload);

    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(1));
    Assert.That(MapRuntimeContext.FindNoteById("valid"), Is.Not.Null);
    Assert.That(MapRuntimeContext.FindNoteById("missingPath"), Is.Null);
    Assert.That(MapRuntimeContext.FindNoteById(""), Is.Null);
    Assert.That(MapRuntimeContext.FindNoteById("valid")?.DirectLinkCount, Is.EqualTo(0));
  }

  [Test]
  public void OnGraphSet_EmptyAndInvalidPayload_AreHandledGracefully()
  {
    bridge.OnGraphSet(string.Empty);

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
  public void OnNoteFocus_WithId_SetsPendingFocusNoteIdWhenCartographerIsPresent()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();

    Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo(string.Empty));

    bridge.OnNoteFocus(TestPayloads.NoteFocusByIdPayload);

    Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo("a2"));
  }

  [Test]
  public void OnNoteFocus_ProtocolMismatch_IsRejectedWithoutStateMutation()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();
    MapRuntimeContext.PendingFocusNoteId = "a1";

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring note:focus due to protocolVersion mismatch\\."));
    bridge.OnNoteFocus(TestPayloads.NoteFocusProtocolMismatchPayload);

    Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo("a1"));
  }

  [Test]
  public void OnNoteFocus_TypeMismatch_IsRejectedWithoutStateMutation()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();
    MapRuntimeContext.PendingFocusNoteId = "a1";

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring note:focus due to message type mismatch\\."));
    bridge.OnNoteFocus(TestPayloads.NoteFocusTypeMismatchPayload);

    Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo("a1"));
  }

  [Test]
  public void OnNoteFocus_EmptyAndInvalidPayload_AreHandledGracefully()
  {
    bridge.OnGraphSet(TestPayloads.RepeatApplyPayloadA);
    EnsureCartographerSingleton();
    MapRuntimeContext.PendingFocusNoteId = "a1";

    bridge.OnNoteFocus(TestPayloads.NoteFocusEmptyPayload);
    Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo("a1"));

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Invalid note:focus payload:"));
    bridge.OnNoteFocus("{ invalid json");
    Assert.That(MapRuntimeContext.PendingFocusNoteId, Is.EqualTo("a1"));
  }

  private static void ResetRuntimeContext()
  {
    MapRuntimeContext.MapLayoutPreference = MapLayoutMode.Auto;
    MapRuntimeContext.PendingFocusNoteId = string.Empty;
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

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    field.SetValue(target, value);
  }

  private static T GetPrivateField<T>(object target, string fieldName)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    return (T)field.GetValue(target);
  }

  private static CrystalType ResolveCrystalType(MethodInfo resolver, int directLinkCount)
  {
    return (CrystalType)resolver.Invoke(null, new object[] { directLinkCount });
  }

  private sealed class TestCartographerEngine : ICartographerEngine
  {
    private readonly Vector3 pivot;

    public TestCartographerEngine(MapLayoutMode engineType)
      : this(engineType, Vector3.zero)
    {
    }

    public TestCartographerEngine(MapLayoutMode engineType, Vector3 pivot)
    {
      EngineType = engineType;
      this.pivot = pivot;
    }

    public bool RequiresTick => false;
    public float BoundRadius => 1f;
    public Vector3 Pivot => pivot;
    public MapLayoutMode EngineType { get; }
    public int MaxActiveLines => 0;
    public int MaxActiveLongLines => 0;
    public ScapeCameraWarper ScapeWarper => null;
    public IReadOnlyList<Star> Stars => new List<Star>();
    public IReadOnlyList<TagNode> TagNodes => new List<TagNode>();
    public event System.Action<IReadOnlyList<Star>, IReadOnlyList<TagNode>> OnNodesChanged
    {
      add { }
      remove { }
    }

    public void Tick(float dt) { }
    public void BuildGraph(List<NoteData> notes) { }
    public void ClearGraph() { }
    public void ApplyView(ScapeView view) { }

    public bool TryGetNavigationWorld(Transform tr, out Vector3 pos)
    {
      if (tr == null)
      {
        pos = default(Vector3);
        return false;
      }

      pos = tr.position;
      return true;
    }
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

    public const string DirectLinkCountPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"n1\",\"path\":\"links/n1.md\",\"title\":\"N1\",\"tags\":[],\"size\":1}," +
      "{\"id\":\"n2\",\"path\":\"links/n2.md\",\"title\":\"N2\",\"tags\":[],\"size\":1}," +
      "{\"id\":\"n3\",\"path\":\"links/n3.md\",\"title\":\"N3\",\"tags\":[],\"size\":1}," +
      "{\"id\":\"n4\",\"path\":\"links/n4.md\",\"title\":\"N4\",\"tags\":[],\"size\":1}" +
      "],\"links\":[" +
      "{\"sourceId\":\"n1\",\"targetId\":\"n2\",\"weight\":1}," +
      "{\"sourceId\":\"n2\",\"targetId\":\"n1\",\"weight\":1}," +
      "{\"sourceId\":\"n1\",\"targetId\":\"n3\",\"weight\":1}," +
      "{\"sourceId\":\"n1\",\"targetId\":\"missing\",\"weight\":1}," +
      "{\"sourceId\":\"n3\",\"targetId\":\"n3\",\"weight\":1}" +
      "]}}";

    public const string RepeatApplyPayloadB =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"b1\",\"path\":\"y/b1.md\",\"title\":\"B1\",\"tags\":[\"solo\"],\"date\":\"2025-02-01T00:00:00Z\",\"size\":15}" +
      "],\"links\":[]}}";

    public const string MalformedNotesPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"valid\",\"path\":\"valid/path.md\",\"title\":\"Valid\",\"tags\":[],\"size\":1}," +
      "{\"id\":\"\",\"path\":\"invalid/empty-id.md\",\"title\":\"Empty Id\",\"tags\":[],\"size\":1}," +
      "{\"id\":\"missingPath\",\"path\":\"\",\"title\":\"Empty Path\",\"tags\":[],\"size\":1}" +
      "],\"links\":[" +
      "{\"sourceId\":\"valid\",\"targetId\":\"missingPath\",\"weight\":1}" +
      "]}}";

    public const string FallbacksPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"f1\",\"path\":\"fallback/f1.md\",\"title\":\"   \",\"tags\":[],\"date\":\"not-an-iso-date\",\"size\":-11}," +
      "{\"id\":\"f2\",\"path\":\"fallback/f2.md\",\"tags\":[\"solo\"],\"size\":5}" +
      "],\"links\":[]}}";

    public const string LayoutPreferenceDynamicLinksPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"mapLayout\":\"dynamicLinks\",\"notes\":[" +
      "{\"id\":\"e1\",\"path\":\"engine/dynamicLinks.md\",\"title\":\"DynamicLinks\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string LayoutPreferenceDatesPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"mapLayout\":\"dates\",\"notes\":[" +
      "{\"id\":\"e2\",\"path\":\"engine/dates.md\",\"title\":\"Dates\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string LayoutPreferenceScalableLinksPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"mapLayout\":\"scalableLinks\",\"notes\":[" +
      "{\"id\":\"e4\",\"path\":\"engine/scalableLinks.md\",\"title\":\"ScalableLinks\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string LayoutPreferenceInvalidPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"mapLayout\":\"unsupported\",\"notes\":[" +
      "{\"id\":\"e3\",\"path\":\"engine/auto.md\",\"title\":\"Auto\",\"tags\":[],\"date\":\"2025-01-01T00:00:00Z\",\"size\":1}" +
      "],\"links\":[]}}";

    public const string NoteFocusByIdPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:focus\",\"payload\":{\"id\":\"a2\",\"path\":\"X/A2.md\"}}";

    public const string NoteFocusEmptyPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:focus\",\"payload\":{}}";

    public const string NoteFocusProtocolMismatchPayload =
      "{\"protocolVersion\":\"9.9.9\",\"type\":\"note:focus\",\"payload\":{\"id\":\"a2\",\"path\":\"X/A2.md\"}}";

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
