using System.Collections;
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
  private GameObject buildingManagerObject;
  private GameObject buildingCalloutPrefabObject;
  private int originalTargetFrameRate;
  private int originalVSyncCount;

  [SetUp]
  public void SetUp()
  {
    originalTargetFrameRate = Application.targetFrameRate;
    originalVSyncCount = QualitySettings.vSyncCount;
    SetCartographerSingleton(null);
    SetBuildingManagerSingleton(null);
    EnsureBuildingManagerSingleton();
    ResetRuntimeContext();
    bridgeObject = new GameObject("ObsidianBridgeEditModeTests");
    bridge = bridgeObject.AddComponent<ObsidianBridge>();
    ResetBridgeSubscriptions();
  }

  [TearDown]
  public void TearDown()
  {
    SetCartographerSingleton(null);
    SetBuildingManagerSingleton(null);

    if (cartographerObject != null)
      Object.DestroyImmediate(cartographerObject);

    if (bridgeObject != null)
      Object.DestroyImmediate(bridgeObject);

    if (buildingManagerObject != null)
      Object.DestroyImmediate(buildingManagerObject);

    if (buildingCalloutPrefabObject != null)
      Object.DestroyImmediate(buildingCalloutPrefabObject);

    Application.targetFrameRate = originalTargetFrameRate;
    QualitySettings.vSyncCount = originalVSyncCount;
  }

  [Test]
  public void OnGraphSet_MinimalPayload_MapsRuntimeStateAndNormalizesWeight()
  {
    bridge.OnGraphSet(TestPayloads.MinimalGraphSetPayload);

    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(2));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(1));
    Assert.That(MapRuntimeContext.LatestGraphRequestId, Is.EqualTo("req-minimal"));
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
  public void OnGraphSet_Buildings_MapsOptionalBuildingNames()
  {
    bridge.OnGraphSet(TestPayloads.BuildingsPayload);

    NoteData noteWithBuildings = MapRuntimeContext.FindNoteById("b1");
    NoteData noteWithoutBuildings = MapRuntimeContext.FindNoteById("b2");

    Assert.That(noteWithBuildings, Is.Not.Null);
    Assert.That(noteWithoutBuildings, Is.Not.Null);
    Assert.That(noteWithBuildings.Buildings, Has.Count.EqualTo(2));
    Assert.That(noteWithBuildings.Buildings[0].Name, Is.EqualTo("Observatory"));
    Assert.That(noteWithBuildings.Buildings[1].Name, Is.EqualTo("Archive"));
    Assert.That(noteWithoutBuildings.Buildings, Is.Empty);
  }

  [Test]
  public void OnNoteUpdate_ExistingNote_ReplacesBuildingsWithoutGraphChange()
  {
    bridge.OnGraphSet(TestPayloads.BuildingsPayload);
    int notesVersion = MapRuntimeContext.NotesVersion;
    var changedNoteIds = new List<string>();
    int notesChangedCount = 0;

    void HandleNoteBuildingsChanged(string noteId) => changedNoteIds.Add(noteId);
    void HandleNotesChanged(string requestId) => notesChangedCount++;

    MapRuntimeContext.OnNoteBuildingsChanged += HandleNoteBuildingsChanged;
    MapRuntimeContext.OnNotesChanged += HandleNotesChanged;
    try
    {
      bridge.OnNoteUpdate(TestPayloads.NoteUpdateBuildingsPayload);

      NoteData noteWithBuildings = MapRuntimeContext.FindNoteById("b1");
      Assert.That(noteWithBuildings.Buildings, Has.Count.EqualTo(2));
      Assert.That(noteWithBuildings.Buildings[0].Name, Is.EqualTo("Tower"));
      Assert.That(noteWithBuildings.Buildings[1].Name, Is.EqualTo("Library"));
      Assert.That(changedNoteIds, Is.EqualTo(new List<string> { "b1" }));
      Assert.That(notesChangedCount, Is.EqualTo(0));
      Assert.That(MapRuntimeContext.NotesVersion, Is.EqualTo(notesVersion));
    }
    finally
    {
      MapRuntimeContext.OnNoteBuildingsChanged -= HandleNoteBuildingsChanged;
      MapRuntimeContext.OnNotesChanged -= HandleNotesChanged;
    }
  }

  [Test]
  public void OnNoteUpdate_EmptyBuildings_ClearsBuildings()
  {
    bridge.OnGraphSet(TestPayloads.BuildingsPayload);

    bridge.OnNoteUpdate(TestPayloads.NoteUpdateEmptyBuildingsPayload);

    Assert.That(MapRuntimeContext.FindNoteById("b1")?.Buildings, Is.Empty);
  }

  [Test]
  public void OnNoteUpdate_UnknownNoteOrPathMismatch_DoesNotMutate()
  {
    bridge.OnGraphSet(TestPayloads.BuildingsPayload);
    var changedNoteIds = new List<string>();
    void HandleNoteBuildingsChanged(string noteId) => changedNoteIds.Add(noteId);

    MapRuntimeContext.OnNoteBuildingsChanged += HandleNoteBuildingsChanged;
    try
    {
      LogAssert.Expect(
        LogType.Log,
        new Regex("\\[MapRuntimeContext\\] Ignoring note buildings update due to path mismatch\\. id=b1, expectedPath=buildings/b1\\.md, receivedPath=other/b1\\.md"));
      bridge.OnNoteUpdate(TestPayloads.NoteUpdatePathMismatchPayload);

      LogAssert.Expect(
        LogType.Log,
        new Regex("\\[MapRuntimeContext\\] Ignoring note buildings update for unknown note\\. id=missing, path=buildings/missing\\.md"));
      bridge.OnNoteUpdate(TestPayloads.NoteUpdateUnknownNotePayload);

      NoteData noteWithBuildings = MapRuntimeContext.FindNoteById("b1");
      Assert.That(noteWithBuildings.Buildings, Has.Count.EqualTo(2));
      Assert.That(noteWithBuildings.Buildings[0].Name, Is.EqualTo("Observatory"));
      Assert.That(noteWithBuildings.Buildings[1].Name, Is.EqualTo("Archive"));
      Assert.That(changedNoteIds, Is.Empty);
    }
    finally
    {
      MapRuntimeContext.OnNoteBuildingsChanged -= HandleNoteBuildingsChanged;
    }
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
  public void RebuildGraphAfterClear_EmptyNotes_ClearsStaleGraphIndex()
  {
    var cartographerObject = new GameObject("CartographerEmptyGraphIndexTests");
    var focusObject = new GameObject("CartographerEmptyGraphIndexTests_Focus");
    var cameraObject = new GameObject("CartographerEmptyGraphIndexTests_Camera");
    var startObject = new GameObject("CartographerEmptyGraphIndexTests_CameraStart");
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
      var resetCameraTarget = new Vector3(8f, 0f, 9f);
      SetPrivateField(cameraController, "targetPos", new Vector3(4f, 5f, 6f));
      startObject.transform.position = new Vector3(resetCameraTarget.x, 3f, resetCameraTarget.z);
      SetPrivateField(cameraController, "startPosition", startObject.transform);
      MapRuntimeContext.SetNotes(new List<NoteData>(), string.Empty);

      Assert.That(cartographer.GraphIndex.TryGetStar("stale", out _), Is.True);

      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.DynamicLinks);

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      Assert.That(cartographer.GraphIndex.Nodes, Is.Empty);
      Assert.That(cartographer.GraphIndex.TryGetStar("stale", out _), Is.False);
      Assert.That(GetPrivateField<Vector3>(cameraController, "targetPos"), Is.EqualTo(resetCameraTarget));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(focusObject);
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(startObject);
      Object.DestroyImmediate(staleStarObject);
    }
  }

  [Test]
  public void RebuildGraphAfterClear_NonEmptyNotes_ClearsStaleGraphIndexWithoutResettingFocus()
  {
    var cartographerObject = new GameObject("CartographerNonEmptyClearedStateTests");
    var focusObject = new GameObject("CartographerNonEmptyClearedStateTests_Focus");
    var cameraObject = new GameObject("CartographerNonEmptyClearedStateTests_Camera");
    var startObject = new GameObject("CartographerNonEmptyClearedStateTests_CameraStart");
    var staleStarObject = new GameObject("CartographerNonEmptyClearedStateTests_StaleStar");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var focusNode = focusObject.AddComponent<FocusNode>();
      var cameraController = cameraObject.AddComponent<CameraOrbitalController>();
      var engine = new TestCartographerEngine(MapLayoutMode.DynamicLinks);
      var staleStar = staleStarObject.AddComponent<Star>();
      staleStar.SetData(new NoteData { Id = "stale", Path = "notes/stale.md" });
      MapGraphIndex staleIndex = MapGraphIndex.Build(
        new List<Star> { staleStar },
        new List<TagNode>(),
        new List<MapRuntimeContext.RuntimeNoteLink>());
      var unchangedCameraTarget = new Vector3(4f, 5f, 6f);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "focusNode", focusNode);
      SetPrivateField(focusNode, "cameraController", cameraController);
      SetPrivateField(cartographer, "_dynamicLinksEngine", engine);
      SetPrivateField(cartographer, "<GraphIndex>k__BackingField", staleIndex);
      SetPrivateField(cameraController, "targetPos", unchangedCameraTarget);
      startObject.transform.position = new Vector3(8f, 3f, 9f);
      SetPrivateField(cameraController, "startPosition", startObject.transform);
      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "next", Path = "notes/next.md" } }, string.Empty);

      Assert.That(cartographer.GraphIndex.TryGetStar("stale", out _), Is.True);

      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.DynamicLinks);

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      Assert.That(cartographer.GraphIndex.Nodes, Is.Empty);
      Assert.That(cartographer.GraphIndex.TryGetStar("stale", out _), Is.False);
      Assert.That(GetPrivateField<Vector3>(cameraController, "targetPos"), Is.EqualTo(unchangedCameraTarget));
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(0));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(1));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(focusObject);
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(startObject);
      Object.DestroyImmediate(staleStarObject);
    }
  }

  [Test]
  public void RebuildGraphAfterClear_SameEngine_ClearsCurrentEngineBeforeBuild()
  {
    var cartographerObject = new GameObject("CartographerSameEngineRebuildTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var engine = new TestCartographerEngine(MapLayoutMode.DynamicLinks);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_dynamicLinksEngine", engine);
      SetPrivateField(cartographer, "_activeEngine", engine);
      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "next", Path = "notes/next.md" } }, string.Empty);

      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.DynamicLinks);

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      Assert.That(engine.ClearGraphCallCount, Is.EqualTo(1));
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(0));
      Assert.That(cartographer.ActiveEngine, Is.SameAs(engine));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(1));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
    }
  }

  [Test]
  public void RebuildGraphAfterClear_SwitchEngine_ClearsPreviousEngineOnly()
  {
    var cartographerObject = new GameObject("CartographerSwitchEngineRebuildTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var previousEngine = new TestCartographerEngine(MapLayoutMode.DynamicLinks);
      var nextEngine = new TestCartographerEngine(MapLayoutMode.Dates);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_activeEngine", previousEngine);
      SetPrivateField(cartographer, "_datesEngine", nextEngine);
      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "next", Path = "notes/next.md" } }, string.Empty);

      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.Dates);

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      Assert.That(previousEngine.ClearGraphCallCount, Is.EqualTo(1));
      Assert.That(previousEngine.BuildGraphCallCount, Is.EqualTo(0));
      Assert.That(nextEngine.ClearGraphCallCount, Is.EqualTo(0));
      Assert.That(nextEngine.BuildGraphCallCount, Is.EqualTo(0));
      Assert.That(cartographer.ActiveEngine, Is.SameAs(nextEngine));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      Assert.That(nextEngine.BuildGraphCallCount, Is.EqualTo(1));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
    }
  }

  [Test]
  public void RebuildGraphAfterClear_SwitchEngine_EmptyIndexUsesNextEngineLineBudget()
  {
    var cartographerObject = new GameObject("CartographerSwitchEngineLineBudgetTests");
    var lineBuilderObject = new GameObject("CartographerSwitchEngineLineBudgetTests_LineBuilder");
    var focusObject = new GameObject("CartographerSwitchEngineLineBudgetTests_Focus");
    var cameraObject = new GameObject("CartographerSwitchEngineLineBudgetTests_Camera");
    var startObject = new GameObject("CartographerSwitchEngineLineBudgetTests_CameraStart");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var lineBuilder = lineBuilderObject.AddComponent<LineBuilder>();
      var focusNode = focusObject.AddComponent<FocusNode>();
      var cameraController = cameraObject.AddComponent<CameraOrbitalController>();
      var previousEngine = new TestCartographerEngine(MapLayoutMode.DynamicLinks, maxActiveLines: 200);
      var nextEngine = new TestCartographerEngine(MapLayoutMode.Dates, maxActiveLines: 0);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_activeEngine", previousEngine);
      SetPrivateField(cartographer, "_datesEngine", nextEngine);
      SetPrivateField(cartographer, "lineBuilder", lineBuilder);
      SetPrivateField(cartographer, "focusNode", focusNode);
      SetPrivateField(focusNode, "cameraController", cameraController);
      SetPrivateField(cameraController, "startPosition", startObject.transform);
      MapRuntimeContext.SetNotes(new List<NoteData>(), string.Empty);

      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.Dates);

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      Assert.That(GetPrivateField<int>(lineBuilder, "activeLineLimit"), Is.EqualTo(0));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      Assert.That(nextEngine.BuildGraphCallCount, Is.EqualTo(1));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
      Object.DestroyImmediate(lineBuilderObject);
      Object.DestroyImmediate(focusObject);
      Object.DestroyImmediate(cameraObject);
      Object.DestroyImmediate(startObject);
    }
  }

  [Test]
  public void RebuildGraphAfterClear_BuildsCurrentRuntimeNotesAfterClearFrame()
  {
    var cartographerObject = new GameObject("CartographerRebuildCurrentRuntimeNotesTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var engine = new TestCartographerEngine(MapLayoutMode.DynamicLinks);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_dynamicLinksEngine", engine);

      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "old", Path = "notes/old.md" } }, string.Empty);
      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.DynamicLinks);
      Assert.That(rebuildGraph.MoveNext(), Is.True);

      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "latest", Path = "notes/latest.md" } }, string.Empty);

      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(0));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(1));
      Assert.That(engine.LastBuiltNotes, Has.Count.EqualTo(1));
      Assert.That(engine.LastBuiltNotes[0].Id, Is.EqualTo("latest"));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
    }
  }

  [Test]
  public void RebuildGraphAfterClear_BuildsAfterClearFrame()
  {
    var cartographerObject = new GameObject("CartographerRebuildCurrentVersionTests");
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var engine = new TestCartographerEngine(MapLayoutMode.DynamicLinks);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_dynamicLinksEngine", engine);

      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "latest", Path = "notes/latest.md" } }, string.Empty);
      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.DynamicLinks);

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(0));

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      Assert.That(engine.BuildGraphCallCount, Is.EqualTo(1));
      Assert.That(engine.LastBuiltNotes, Has.Count.EqualTo(1));
      Assert.That(engine.LastBuiltNotes[0].Id, Is.EqualTo("latest"));
    }
    finally
    {
      Object.DestroyImmediate(cartographerObject);
    }
  }

  [Test]
  public void RequestGraphReady_UsesCapturedRequestId()
  {
    var readyRequestIds = new List<string>();
    void HandleReady(string requestId) => readyRequestIds.Add(requestId);

    MapRuntimeContext.OnGraphReady += HandleReady;
    try
    {
      MapRuntimeContext.SetLatestGraphRequestId("req-old");
      MapRuntimeContext.SetBuildingGraphRequestId(MapRuntimeContext.LatestGraphRequestId);
      MapRuntimeContext.SetLatestGraphRequestId("req-new");

      MapRuntimeContext.RequestGraphReady();

      Assert.That(readyRequestIds, Is.EqualTo(new List<string> { "req-old" }));
    }
    finally
    {
      MapRuntimeContext.OnGraphReady -= HandleReady;
    }
  }

  [Test]
  public void RequestTagActivate_KnownTag_EmitsBridgeTagName()
  {
    var activatedTags = new List<string>();
    void HandleTagActivate(string tag) => activatedTags.Add(tag);

    MapRuntimeContext.OnTagActivateRequested += HandleTagActivate;
    try
    {
      LogAssert.Expect(LogType.Log, new Regex("\\[MapRuntimeContext\\] Tag activate requested: tag=project"));
      LogAssert.Expect(LogType.Log, new Regex("\\[ObsidianBridge\\] tag:activate requested \\(Editor/Non-WebGL\\): tag=project"));

      MapRuntimeContext.SetTagNames(new Dictionary<int, string> { { 7, "project" } });
      MapRuntimeContext.RequestTagActivate(7);

      Assert.That(activatedTags, Is.EqualTo(new List<string> { "project" }));
    }
    finally
    {
      MapRuntimeContext.OnTagActivateRequested -= HandleTagActivate;
    }
  }

  [Test]
  public void RequestTagActivate_UnknownOrEmptyTag_DoesNotEmit()
  {
    var activatedTags = new List<string>();
    void HandleTagActivate(string tag) => activatedTags.Add(tag);

    MapRuntimeContext.OnTagActivateRequested += HandleTagActivate;
    try
    {
      MapRuntimeContext.SetTagNames(new Dictionary<int, string> { { 7, "   " } });

      MapRuntimeContext.RequestTagActivate(7);
      MapRuntimeContext.RequestTagActivate(8);

      Assert.That(activatedTags, Is.Empty);
    }
    finally
    {
      MapRuntimeContext.OnTagActivateRequested -= HandleTagActivate;
    }
  }

  [Test]
  public void RebuildGraphAfterClear_ReadyScopeUsesCoroutineRequestId()
  {
    var readyRequestIds = new List<string>();
    void HandleReady(string requestId) => readyRequestIds.Add(requestId);

    var cartographerObject = new GameObject("CartographerRebuildReadyScopeTests");
    MapRuntimeContext.OnGraphReady += HandleReady;
    try
    {
      var cartographer = cartographerObject.AddComponent<Cartographer>();
      var engine = new TestCartographerEngine(MapLayoutMode.DynamicLinks);

      SetCartographerSingleton(cartographer);
      SetPrivateField(cartographer, "_dynamicLinksEngine", engine);

      MapRuntimeContext.SetNotes(new List<NoteData> { new NoteData { Id = "old", Path = "notes/old.md" } }, "req-old");
      IEnumerator rebuildGraph = InvokeCartographerRebuildGraphAfterClear(
        cartographer,
        MapLayoutMode.DynamicLinks,
        "req-old");

      Assert.That(rebuildGraph.MoveNext(), Is.True);
      MapRuntimeContext.SetLatestGraphRequestId("req-new");

      Assert.That(rebuildGraph.MoveNext(), Is.False);
      MapRuntimeContext.RequestGraphReady();

      Assert.That(readyRequestIds, Is.EqualTo(new List<string> { "req-old" }));
    }
    finally
    {
      MapRuntimeContext.OnGraphReady -= HandleReady;
      Object.DestroyImmediate(cartographerObject);
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
  public void BuildingCallout_ResolveDirection_NormalizesNameForStableLayout()
  {
    MethodInfo resolver = typeof(BuildingCallout).GetMethod(
      "ResolveDirection",
      BindingFlags.Static | BindingFlags.NonPublic);

    Assert.That(resolver, Is.Not.Null);
    var elevationRange = new Vector2(15f, 90f);
    Vector3 first = ResolveBuildingDirection(resolver, "  Name  ", elevationRange, 64);
    Vector3 second = ResolveBuildingDirection(resolver, "name", elevationRange, 64);

    Assert.That(Vector3.Distance(first, second), Is.LessThan(0.000001f));
  }

  [Test]
  public void BuildingCallout_ResolvePreferredSlot_DistributesSequentialNames()
  {
    var slots = new HashSet<int>
    {
      BuildingCallout.ResolvePreferredSlot("Building 1", 64),
      BuildingCallout.ResolvePreferredSlot("Building 2", 64),
      BuildingCallout.ResolvePreferredSlot("Building 3", 64),
      BuildingCallout.ResolvePreferredSlot("Building 4", 64)
    };

    Assert.That(slots, Has.Count.EqualTo(4));
  }

  [Test]
  public void BuildingCallout_ResolveAvailableSlot_UsesFirstFreeSlotAfterOccupiedPreferredSlot()
  {
    var occupiedSlots = new bool[8];
    occupiedSlots[2] = true;
    occupiedSlots[3] = true;

    int resolvedSlot = BuildingCallout.ResolveAvailableSlot(2, occupiedSlots);

    Assert.That(resolvedSlot, Is.EqualTo(4));
  }

  [Test]
  public void BuildingCallout_ResolveSlotDirection_Uses3DSlotsWithinElevationRange()
  {
    MethodInfo resolver = typeof(BuildingCallout).GetMethod(
      "ResolveSlotDirection",
      BindingFlags.Static | BindingFlags.NonPublic);

    Assert.That(resolver, Is.Not.Null);
    var elevationRange = new Vector2(15f, 90f);
    Vector3 first = ResolveSlotDirection(resolver, 0, 64, elevationRange);
    Vector3 second = ResolveSlotDirection(resolver, 2, 64, elevationRange);
    float firstElevationDeg = Mathf.Asin(Mathf.Abs(first.y)) * Mathf.Rad2Deg;
    float secondElevationDeg = Mathf.Asin(Mathf.Abs(second.y)) * Mathf.Rad2Deg;

    Assert.That(firstElevationDeg, Is.InRange(15f, 90f));
    Assert.That(secondElevationDeg, Is.InRange(15f, 90f));
    Assert.That(Mathf.Abs(first.y - second.y), Is.GreaterThan(0.000001f));
  }

  [Test]
  public void StableTextHash_NormalizeCaseInsensitiveKey_TrimsAndUppercases()
  {
    Assert.That(StableTextHash.NormalizeCaseInsensitiveKey("  Name  "), Is.EqualTo("NAME"));
    Assert.That(StableTextHash.NormalizeCaseInsensitiveKey(null), Is.EqualTo(string.Empty));
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

  [Test]
  public void OnRuntimeSettings_AppliesFrameRateModes()
  {
    bridge.OnRuntimeSettings(TestPayloads.RuntimeSettingsAutoPayload);
    Assert.That(QualitySettings.vSyncCount, Is.EqualTo(1));
    Assert.That(Application.targetFrameRate, Is.EqualTo(-1));

    bridge.OnRuntimeSettings(TestPayloads.RuntimeSettingsFps60Payload);
    Assert.That(QualitySettings.vSyncCount, Is.EqualTo(0));
    Assert.That(Application.targetFrameRate, Is.EqualTo(60));

    bridge.OnRuntimeSettings(TestPayloads.RuntimeSettingsFps30Payload);
    Assert.That(QualitySettings.vSyncCount, Is.EqualTo(0));
    Assert.That(Application.targetFrameRate, Is.EqualTo(30));

    bridge.OnRuntimeSettings(TestPayloads.RuntimeSettingsFps24Payload);
    Assert.That(QualitySettings.vSyncCount, Is.EqualTo(0));
    Assert.That(Application.targetFrameRate, Is.EqualTo(24));
  }

  [Test]
  public void OnRuntimeSettings_InvalidEnvelope_IsRejectedWithoutMutation()
  {
    QualitySettings.vSyncCount = 2;
    Application.targetFrameRate = -1;

    LogAssert.Expect(LogType.Warning, new Regex("\\[ObsidianBridge\\] Ignoring runtime:settings due to protocolVersion mismatch\\."));
    bridge.OnRuntimeSettings(TestPayloads.RuntimeSettingsProtocolMismatchPayload);
    Assert.That(QualitySettings.vSyncCount, Is.EqualTo(2));
    Assert.That(Application.targetFrameRate, Is.EqualTo(-1));
  }

  private static void ResetRuntimeContext()
  {
    MapRuntimeContext.MapLayoutPreference = MapLayoutMode.Auto;
    MapRuntimeContext.PendingFocusNoteId = string.Empty;
    MapRuntimeContext.SetLatestGraphRequestId(string.Empty);
    MapRuntimeContext.ClearBuildingGraphRequestId();
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());
    MapRuntimeContext.SetNotes(new List<NoteData>(), string.Empty);
    ResetBridgeShutdownState();
  }

  private static void ResetBridgeShutdownState()
  {
    FieldInfo shutdownField = typeof(ObsidianBridge).GetField("IsRuntimeShuttingDown", BindingFlags.Static | BindingFlags.NonPublic);
    Assert.That(shutdownField, Is.Not.Null, "Missing ObsidianBridge shutdown field.");
    shutdownField.SetValue(null, false);
  }

  private void ResetBridgeSubscriptions()
  {
    InvokeBridgeLifecycleMethod("OnDisable");
    InvokeBridgeLifecycleMethod("OnEnable");
  }

  private void InvokeBridgeLifecycleMethod(string methodName)
  {
    MethodInfo method = typeof(ObsidianBridge).GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(method, Is.Not.Null, $"Missing ObsidianBridge lifecycle method {methodName}.");
    method.Invoke(bridge, null);
  }

  private void EnsureCartographerSingleton()
  {
    cartographerObject = new GameObject("CartographerEditModeTests");
    Cartographer cartographer = cartographerObject.AddComponent<Cartographer>();
    SetCartographerSingleton(cartographer);
  }

  private void EnsureBuildingManagerSingleton()
  {
    buildingCalloutPrefabObject = new GameObject("ObsidianBridgeEditModeTests_BuildingCalloutPrefab");
    BuildingCallout calloutPrefab = buildingCalloutPrefabObject.AddComponent<BuildingCallout>();

    buildingManagerObject = new GameObject("ObsidianBridgeEditModeTests_BuildingManager");
    buildingManagerObject.SetActive(false);
    BuildingManager manager = buildingManagerObject.AddComponent<BuildingManager>();
    SetPrivateField(manager, "buildingPrefab", calloutPrefab);
    InvokeBuildingManagerAwake(manager);
  }

  private static void SetCartographerSingleton(Cartographer value)
  {
    FieldInfo singletonBackingField =
      typeof(Cartographer).GetField("<I>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic);
    singletonBackingField?.SetValue(null, value);
  }

  private static void SetBuildingManagerSingleton(BuildingManager value)
  {
    FieldInfo singletonBackingField =
      typeof(BuildingManager).GetField("<I>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic);
    singletonBackingField?.SetValue(null, value);
  }

  private static void SetPrivateField(object target, string fieldName, object value)
  {
    FieldInfo field = target.GetType().GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(field, Is.Not.Null, $"Missing field {fieldName}.");
    field.SetValue(target, value);
  }

  private static void InvokeBuildingManagerAwake(BuildingManager manager)
  {
    MethodInfo awakeMethod = typeof(BuildingManager).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(awakeMethod, Is.Not.Null, "Missing BuildingManager.Awake.");
    awakeMethod.Invoke(manager, null);
  }

  private static IEnumerator InvokeCartographerRebuildGraphAfterClear(
    Cartographer cartographer,
    MapLayoutMode layoutPreference,
    string requestId = "")
  {
    MethodInfo rebuildGraph = typeof(Cartographer).GetMethod("RebuildGraphAfterClear", BindingFlags.Instance | BindingFlags.NonPublic);
    Assert.That(rebuildGraph, Is.Not.Null);
    try
    {
      return (IEnumerator)rebuildGraph.Invoke(cartographer, new object[] { layoutPreference, requestId });
    }
    catch (TargetInvocationException ex) when (ex.InnerException != null)
    {
      throw ex.InnerException;
    }
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

  private static Vector3 ResolveBuildingDirection(
    MethodInfo resolver,
    string buildingName,
    Vector2 elevationRange,
    int slotCount)
  {
    return (Vector3)resolver.Invoke(null, new object[] { buildingName, elevationRange, slotCount });
  }

  private static Vector3 ResolveSlotDirection(
    MethodInfo resolver,
    int slotIndex,
    int slotCount,
    Vector2 elevationRange)
  {
    return (Vector3)resolver.Invoke(null, new object[] { slotIndex, slotCount, elevationRange });
  }

  private sealed class TestCartographerEngine : ICartographerEngine
  {
    private readonly Vector3 pivot;

    public TestCartographerEngine(MapLayoutMode engineType)
      : this(engineType, Vector3.zero)
    {
    }

    public TestCartographerEngine(MapLayoutMode engineType, Vector3 pivot)
      : this(engineType, pivot, 0)
    {
    }

    public TestCartographerEngine(MapLayoutMode engineType, int maxActiveLines)
      : this(engineType, Vector3.zero, maxActiveLines)
    {
    }

    private TestCartographerEngine(MapLayoutMode engineType, Vector3 pivot, int maxActiveLines)
    {
      EngineType = engineType;
      this.pivot = pivot;
      MaxActiveLines = maxActiveLines;
    }

    public bool RequiresTick => false;
    public float BoundRadius => 1f;
    public Vector3 Pivot => pivot;
    public MapLayoutMode EngineType { get; }
    public int BuildGraphCallCount { get; private set; }
    public int ClearGraphCallCount { get; private set; }
    public List<NoteData> LastBuiltNotes { get; private set; } = new();
    public int MaxActiveLines { get; }
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
    public void BuildGraph(List<NoteData> notes)
    {
      BuildGraphCallCount++;
      LastBuiltNotes = notes;
    }

    public void ClearGraph()
    {
      ClearGraphCallCount++;
    }

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

    public const string BuildingsPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
      "{\"id\":\"b1\",\"path\":\"buildings/b1.md\",\"title\":\"B1\",\"tags\":[],\"size\":1,\"buildings\":[\" Observatory \",\"\",\"Archive\"]}," +
      "{\"id\":\"b2\",\"path\":\"buildings/b2.md\",\"title\":\"B2\",\"tags\":[],\"size\":1}" +
      "],\"links\":[]}}";

    public const string NoteUpdateBuildingsPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:update\",\"payload\":{\"id\":\"b1\",\"path\":\"buildings/b1.md\",\"buildings\":[\" Tower \",\"\",\"Library\"]}}";

    public const string NoteUpdateEmptyBuildingsPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:update\",\"payload\":{\"id\":\"b1\",\"path\":\"buildings/b1.md\",\"buildings\":[]}}";

    public const string NoteUpdatePathMismatchPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:update\",\"payload\":{\"id\":\"b1\",\"path\":\"other/b1.md\",\"buildings\":[\"Tower\"]}}";

    public const string NoteUpdateUnknownNotePayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"note:update\",\"payload\":{\"id\":\"missing\",\"path\":\"buildings/missing.md\",\"buildings\":[\"Tower\"]}}";

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

    public const string RuntimeSettingsAutoPayload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"runtime:settings\",\"payload\":{\"frameRateMode\":\"auto\"}}";

    public const string RuntimeSettingsFps60Payload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"runtime:settings\",\"payload\":{\"frameRateMode\":\"fps60\"}}";

    public const string RuntimeSettingsFps30Payload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"runtime:settings\",\"payload\":{\"frameRateMode\":\"fps30\"}}";

    public const string RuntimeSettingsFps24Payload =
      "{\"protocolVersion\":\"2.0.0\",\"type\":\"runtime:settings\",\"payload\":{\"frameRateMode\":\"fps24\"}}";

    public const string RuntimeSettingsProtocolMismatchPayload =
      "{\"protocolVersion\":\"9.9.9\",\"type\":\"runtime:settings\",\"payload\":{\"frameRateMode\":\"fps30\"}}";

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
