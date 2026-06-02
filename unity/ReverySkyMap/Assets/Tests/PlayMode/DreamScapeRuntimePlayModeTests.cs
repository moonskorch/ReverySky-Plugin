using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

public class MapRuntimePlayModeTests
{
  private const string ScenePath = "Assets/Scenes/ScarScapeScene.unity";
  private const int SnapshotWidth = 960;
  private const int SnapshotHeight = 540;

  // Baseline signature for the deterministic payload in this scene.
  // Values are intentionally tolerant and paired with structural asserts to reduce flakiness.
  private const float BaselineLumaMean = 0.107f;
  private const float BaselineLumaStd = 0.042f;
  private const float BaselineEdgeEnergy = 0.006f;
  private const float BaselineSaturationMean = 0.396f;

  private const float ToleranceLumaMean = 0.020f;
  private const float ToleranceLumaStd = 0.020f;
  private const float ToleranceEdgeEnergy = 0.010f;
  private const float ToleranceSaturationMean = 0.035f;

  [UnityTest]
  public IEnumerator RuntimeBootstrap_LoadsSceneAndAppliesPayloadWithoutCriticalErrors()
  {
    using var logProbe = new RuntimeLogProbe();
    yield return LoadTargetScene();
    yield return PrepareRuntimeWithDeterministicPayload();

    Cartographer cartographer = UnityEngine.Object.FindFirstObjectByType<Cartographer>();
    Assert.That(cartographer, Is.Not.Null);
    Assert.That(cartographer.isActiveAndEnabled, Is.True);

    Assert.That(MapRuntimeContext.IsRuntimeMode, Is.True);
    Assert.That(MapRuntimeContext.Notes, Has.Count.EqualTo(3));
    Assert.That(MapRuntimeContext.Links, Has.Count.EqualTo(2));
    NoteData firstNote = MapRuntimeContext.FindNoteById("v1");
    Assert.That(firstNote, Is.Not.Null);
    Assert.That(firstNote.DateTime, Is.EqualTo(DateTime.Parse("2025-04-01T00:00:00Z", null, System.Globalization.DateTimeStyles.RoundtripKind)));
    Assert.That(firstNote.Length, Is.EqualTo(111));

    Star[] stars = UnityEngine.Object.FindObjectsByType<Star>(FindObjectsSortMode.None);
    Assert.That(stars.Length, Is.EqualTo(3));

    List<string> criticalLogs = logProbe.GetCriticalLogs();
    Assert.That(criticalLogs, Is.Empty, string.Join(Environment.NewLine, criticalLogs));
  }

  [UnityTest]
  public IEnumerator RuntimeGraphSet_EnginePreferenceSwitchesActiveCartographerEngine()
  {
    using var logProbe = new RuntimeLogProbe();
    yield return LoadTargetScene();

    Cartographer cartographer = UnityEngine.Object.FindFirstObjectByType<Cartographer>();
    Assert.That(cartographer, Is.Not.Null);

    var bridgeObject = new GameObject("ObsidianBridgeEnginePreferencePlayModeTest");
    var bridge = bridgeObject.AddComponent<ObsidianBridge>();

    bridge.OnGraphSet(ForcesEnginePreferencePayload);
    yield return WaitFrames(4);
    Assert.That(MapRuntimeContext.FilterEngine, Is.EqualTo(CartographerEngine.Forces));
    Assert.That(cartographer.ActiveEngine, Is.Not.Null);
    Assert.That(cartographer.ActiveEngine.EngineType, Is.EqualTo(CartographerEngine.Forces));

    bridge.OnGraphSet(Static25DEnginePreferencePayload);
    yield return WaitFrames(4);
    Assert.That(MapRuntimeContext.FilterEngine, Is.EqualTo(CartographerEngine.Static25D));
    Assert.That(cartographer.ActiveEngine, Is.Not.Null);
    Assert.That(cartographer.ActiveEngine.EngineType, Is.EqualTo(CartographerEngine.Static25D));

    UnityEngine.Object.Destroy(bridgeObject);

    List<string> criticalLogs = logProbe.GetCriticalLogs();
    Assert.That(criticalLogs, Is.Empty, string.Join(Environment.NewLine, criticalLogs));
  }

  [UnityTest]
  public IEnumerator VisualGuard_SnapshotAndStructuralInvariants_AreStable()
  {
    yield return LoadTargetScene();
    yield return PrepareRuntimeWithDeterministicPayload();

    Camera mainCamera = Camera.main;
    Assert.That(mainCamera, Is.Not.Null, "Main camera is required for visual guard.");
    Assert.That(mainCamera.isActiveAndEnabled, Is.True);

    FreezeMovingVisualsForSnapshot();
    yield return WaitFrames(3);

    SnapshotSignature first = CaptureSignature(mainCamera, SnapshotWidth, SnapshotHeight);
    SnapshotSignature second = CaptureSignature(mainCamera, SnapshotWidth, SnapshotHeight);
    Debug.Log($"[VisualGuard] first={first}");
    Debug.Log($"[VisualGuard] second={second}");

    AssertNear(first.LumaMean, BaselineLumaMean, ToleranceLumaMean, nameof(BaselineLumaMean));
    AssertNear(first.LumaStd, BaselineLumaStd, ToleranceLumaStd, nameof(BaselineLumaStd));
    AssertNear(first.EdgeEnergy, BaselineEdgeEnergy, ToleranceEdgeEnergy, nameof(BaselineEdgeEnergy));
    AssertNear(first.SaturationMean, BaselineSaturationMean, ToleranceSaturationMean, nameof(BaselineSaturationMean));

    // Internal self-check to make sure the capture itself is stable across adjacent frames.
    AssertNear(first.LumaMean, second.LumaMean, 0.010f, "FrameToFrame LumaMean");
    AssertNear(first.EdgeEnergy, second.EdgeEnergy, 0.012f, "FrameToFrame EdgeEnergy");

    Star[] stars = UnityEngine.Object.FindObjectsByType<Star>(FindObjectsSortMode.None);
    Assert.That(stars.Length, Is.EqualTo(3));
  }

  private static IEnumerator LoadTargetScene()
  {
    AsyncOperation load = SceneManager.LoadSceneAsync(ScenePath, LoadSceneMode.Single);
    while (!load.isDone)
      yield return null;
    yield return WaitFrames(2);
  }

  private static IEnumerator PrepareRuntimeWithDeterministicPayload()
  {
    MapRuntimeContext.FilterRangeDays = 0;
    MapRuntimeContext.FilterImportance = CrystalType.Unknown;
    MapRuntimeContext.FilterEngine = CartographerEngine.Static25D;
    MapRuntimeContext.SetTagNames(new Dictionary<int, string>());
    MapRuntimeContext.SetLinks(new List<MapRuntimeContext.RuntimeNoteLink>());
    MapRuntimeContext.SetNotes(new List<NoteData>());

    var bridgeObject = new GameObject("ObsidianBridgePlayModeTest");
    var bridge = bridgeObject.AddComponent<ObsidianBridge>();
    bridge.OnGraphSet(DeterministicPayload);
    yield return WaitFrames(4);

    UnityEngine.Object.Destroy(bridgeObject);
  }

  private static IEnumerator WaitFrames(int frames)
  {
    for (int i = 0; i < frames; i++)
      yield return null;
  }

  private static void FreezeMovingVisualsForSnapshot()
  {
    SkyboxRotator[] rotators = UnityEngine.Object.FindObjectsByType<SkyboxRotator>(FindObjectsSortMode.None);
    foreach (SkyboxRotator rotator in rotators)
      rotator.enabled = false;
  }

  private static SnapshotSignature CaptureSignature(Camera camera, int width, int height)
  {
    var renderTexture = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
    var texture = new Texture2D(width, height, TextureFormat.RGB24, false);
    RenderTexture previousActive = RenderTexture.active;
    RenderTexture previousTarget = camera.targetTexture;

    try
    {
      camera.targetTexture = renderTexture;
      camera.Render();
      RenderTexture.active = renderTexture;
      texture.ReadPixels(new Rect(0, 0, width, height), 0, 0, false);
      texture.Apply(false, false);
      return SnapshotSignature.FromTexture(texture);
    }
    finally
    {
      camera.targetTexture = previousTarget;
      RenderTexture.active = previousActive;
      UnityEngine.Object.Destroy(renderTexture);
      UnityEngine.Object.Destroy(texture);
    }
  }

  private static void AssertNear(float actual, float expected, float tolerance, string label)
  {
    Assert.That(Mathf.Abs(actual - expected), Is.LessThanOrEqualTo(tolerance),
      $"{label} out of range. actual={actual:F4}, expected={expected:F4}, tol={tolerance:F4}");
  }

  private readonly struct SnapshotSignature
  {
    public readonly float LumaMean;
    public readonly float LumaStd;
    public readonly float EdgeEnergy;
    public readonly float SaturationMean;

    private SnapshotSignature(float lumaMean, float lumaStd, float edgeEnergy, float saturationMean)
    {
      LumaMean = lumaMean;
      LumaStd = lumaStd;
      EdgeEnergy = edgeEnergy;
      SaturationMean = saturationMean;
    }

    public override string ToString()
    {
      return $"lumaMean={LumaMean:F4}, lumaStd={LumaStd:F4}, edge={EdgeEnergy:F4}, sat={SaturationMean:F4}";
    }

    public static SnapshotSignature FromTexture(Texture2D texture)
    {
      Color[] pixels = texture.GetPixels();
      int width = texture.width;
      int height = texture.height;
      int stride = 4;

      double lumaSum = 0d;
      double satSum = 0d;
      int count = 0;

      for (int y = 0; y < height; y += stride)
      {
        for (int x = 0; x < width; x += stride)
        {
          Color c = pixels[(y * width) + x];
          float luma = (0.2126f * c.r) + (0.7152f * c.g) + (0.0722f * c.b);
          float max = Mathf.Max(c.r, Mathf.Max(c.g, c.b));
          float min = Mathf.Min(c.r, Mathf.Min(c.g, c.b));
          float sat = max <= 0f ? 0f : (max - min) / max;
          lumaSum += luma;
          satSum += sat;
          count++;
        }
      }

      double lumaMean = count > 0 ? lumaSum / count : 0d;
      double satMean = count > 0 ? satSum / count : 0d;

      double varianceSum = 0d;
      double edgeSum = 0d;
      int edgeCount = 0;

      for (int y = 0; y < height - stride; y += stride)
      {
        for (int x = 0; x < width - stride; x += stride)
        {
          Color c = pixels[(y * width) + x];
          Color right = pixels[(y * width) + (x + stride)];
          Color down = pixels[((y + stride) * width) + x];

          float luma = (0.2126f * c.r) + (0.7152f * c.g) + (0.0722f * c.b);
          float rightLuma = (0.2126f * right.r) + (0.7152f * right.g) + (0.0722f * right.b);
          float downLuma = (0.2126f * down.r) + (0.7152f * down.g) + (0.0722f * down.b);

          float dx = Mathf.Abs(rightLuma - luma);
          float dy = Mathf.Abs(downLuma - luma);

          varianceSum += (luma - lumaMean) * (luma - lumaMean);
          edgeSum += dx + dy;
          edgeCount++;
        }
      }

      double lumaStd = edgeCount > 0 ? Math.Sqrt(varianceSum / edgeCount) : 0d;
      double edgeEnergy = edgeCount > 0 ? edgeSum / (edgeCount * 2d) : 0d;

      return new SnapshotSignature((float)lumaMean, (float)lumaStd, (float)edgeEnergy, (float)satMean);
    }
  }

  private sealed class RuntimeLogProbe : IDisposable
  {
    private readonly List<string> critical = new();

    public RuntimeLogProbe()
    {
      Application.logMessageReceived += OnLogReceived;
    }

    public List<string> GetCriticalLogs()
    {
      return critical;
    }

    public void Dispose()
    {
      Application.logMessageReceived -= OnLogReceived;
    }

    private void OnLogReceived(string condition, string stackTrace, LogType type)
    {
      if (type == LogType.Exception || type == LogType.Error || type == LogType.Assert)
        critical.Add($"{type}: {condition}");
    }
  }

  private const string DeterministicPayload =
    "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"notes\":[" +
    "{\"id\":\"v1\",\"path\":\"visual/v1.md\",\"title\":\"Visual 1\",\"tags\":[\"alpha\",\"focus\"],\"date\":\"2025-04-01T00:00:00Z\",\"size\":111}," +
    "{\"id\":\"v2\",\"path\":\"visual/v2.md\",\"title\":\"Visual 2\",\"tags\":[\"focus\",\"beta\"],\"date\":\"2025-04-03T00:00:00Z\",\"size\":222}," +
    "{\"id\":\"v3\",\"path\":\"visual/v3.md\",\"title\":\"Visual 3\",\"tags\":[\"beta\",\"gamma\"],\"date\":\"2025-04-05T00:00:00Z\",\"size\":333}" +
    "],\"links\":[" +
    "{\"sourceId\":\"v1\",\"targetId\":\"v2\",\"weight\":1.0}," +
    "{\"sourceId\":\"v2\",\"targetId\":\"v3\",\"weight\":1.0}" +
    "]}}";

  private const string ForcesEnginePreferencePayload =
    "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"enginePreference\":\"forces\",\"notes\":[" +
    "{\"id\":\"e1\",\"path\":\"engine/e1.md\",\"title\":\"Engine 1\",\"tags\":[\"engine\"],\"date\":\"2025-04-01T00:00:00Z\",\"size\":111}," +
    "{\"id\":\"e2\",\"path\":\"engine/e2.md\",\"title\":\"Engine 2\",\"tags\":[\"engine\"],\"date\":\"2025-04-03T00:00:00Z\",\"size\":222}," +
    "{\"id\":\"e3\",\"path\":\"engine/e3.md\",\"title\":\"Engine 3\",\"tags\":[\"engine\"],\"date\":\"2025-04-05T00:00:00Z\",\"size\":333}" +
    "],\"links\":[" +
    "{\"sourceId\":\"e1\",\"targetId\":\"e2\",\"weight\":1.0}," +
    "{\"sourceId\":\"e2\",\"targetId\":\"e3\",\"weight\":1.0}" +
    "]}}";

  private const string Static25DEnginePreferencePayload =
    "{\"protocolVersion\":\"2.0.0\",\"type\":\"graph:set\",\"payload\":{\"enginePreference\":\"static25d\",\"notes\":[" +
    "{\"id\":\"e1\",\"path\":\"engine/e1.md\",\"title\":\"Engine 1\",\"tags\":[\"engine\"],\"date\":\"2025-04-01T00:00:00Z\",\"size\":111}," +
    "{\"id\":\"e2\",\"path\":\"engine/e2.md\",\"title\":\"Engine 2\",\"tags\":[\"engine\"],\"date\":\"2025-04-03T00:00:00Z\",\"size\":222}," +
    "{\"id\":\"e3\",\"path\":\"engine/e3.md\",\"title\":\"Engine 3\",\"tags\":[\"engine\"],\"date\":\"2025-04-05T00:00:00Z\",\"size\":333}" +
    "],\"links\":[" +
    "{\"sourceId\":\"e1\",\"targetId\":\"e2\",\"weight\":1.0}," +
    "{\"sourceId\":\"e2\",\"targetId\":\"e3\",\"weight\":1.0}" +
    "]}}";
}
