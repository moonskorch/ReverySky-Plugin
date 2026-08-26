using System.Reflection;
using NUnit.Framework;
using UnityEngine;

public sealed class CameraForwardWatcherEditModeTests
{
  private static readonly MethodInfo WatcherAwakeMethod = typeof(CameraForwardWatcher)
    .GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);

  private static readonly MethodInfo LateUpdateMethod = typeof(CameraForwardWatcher)
    .GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);

  private static readonly MethodInfo LabelOnEnableMethod = typeof(LookAtCamera)
    .GetMethod("OnEnable", BindingFlags.Instance | BindingFlags.NonPublic);

  private static readonly MethodInfo LabelOnDisableMethod = typeof(LookAtCamera)
    .GetMethod("OnDisable", BindingFlags.Instance | BindingFlags.NonPublic);

  private static readonly FieldInfo LabelModeField = typeof(LookAtCamera)
    .GetField("mode", BindingFlags.Instance | BindingFlags.NonPublic);

  private static readonly FieldInfo SingletonField = typeof(CameraForwardWatcher)
    .GetField("<I>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic);

  [SetUp]
  public void SetUp()
  {
    ResetWatcherSingleton();
  }

  [TearDown]
  public void TearDown()
  {
    ResetWatcherSingleton();
  }

  [Test]
  public void RegisteredLookAtCamera_AlignsImmediatelyAndFollowsWatcherForwardChanges()
  {
    GameObject cameraObject = null;
    GameObject labelObject = null;

    try
    {
      cameraObject = new GameObject("CameraForwardWatcherTests_Camera");
      cameraObject.transform.rotation = Quaternion.LookRotation(Vector3.forward, Vector3.up);
      CameraForwardWatcher watcher = cameraObject.AddComponent<CameraForwardWatcher>();
      WatcherAwakeMethod.Invoke(watcher, null);

      labelObject = new GameObject("CameraForwardWatcherTests_Label");
      labelObject.transform.forward = Vector3.left;
      LookAtCamera label = labelObject.AddComponent<LookAtCamera>();
      LabelOnEnableMethod.Invoke(label, null);

      AssertForward(label.transform, Vector3.forward);

      cameraObject.transform.rotation = Quaternion.LookRotation(Vector3.right, Vector3.up);
      InvokeLateUpdate(watcher);

      AssertForward(label.transform, Vector3.right);

      LabelOnDisableMethod.Invoke(label, null);
      cameraObject.transform.rotation = Quaternion.LookRotation(Vector3.back, Vector3.up);
      InvokeLateUpdate(watcher);

      AssertForward(label.transform, Vector3.right);
    }
    finally
    {
      if (labelObject != null)
        Object.DestroyImmediate(labelObject);

      if (cameraObject != null)
        Object.DestroyImmediate(cameraObject);

      ResetWatcherSingleton();
    }
  }

  [Test]
  public void EveryFrameLookAtCamera_AlignsImmediatelyOnEnable()
  {
    GameObject cameraObject = null;
    GameObject labelObject = null;

    try
    {
      cameraObject = new GameObject("CameraForwardWatcherTests_Camera");
      cameraObject.transform.rotation = Quaternion.LookRotation(Vector3.right, Vector3.up);
      CameraForwardWatcher watcher = cameraObject.AddComponent<CameraForwardWatcher>();
      WatcherAwakeMethod.Invoke(watcher, null);

      labelObject = new GameObject("CameraForwardWatcherTests_EveryFrameLabel");
      labelObject.SetActive(false);
      LookAtCamera label = labelObject.AddComponent<LookAtCamera>();
      LabelModeField.SetValue(label, LookAtCameraMode.EveryFrame);
      labelObject.transform.forward = Vector3.back;

      LabelOnEnableMethod.Invoke(label, null);

      AssertForward(label.transform, Vector3.right);
    }
    finally
    {
      if (labelObject != null)
        Object.DestroyImmediate(labelObject);

      if (cameraObject != null)
        Object.DestroyImmediate(cameraObject);

      ResetWatcherSingleton();
    }
  }

  private static void InvokeLateUpdate(CameraForwardWatcher watcher)
  {
    LateUpdateMethod.Invoke(watcher, null);
  }

  private static void AssertForward(Transform transform, Vector3 expectedForward)
  {
    Assert.That(
      Vector3.Dot(transform.forward, expectedForward),
      Is.GreaterThan(0.999999f));
  }

  private static void ResetWatcherSingleton()
  {
    SingletonField.SetValue(null, null);
  }
}
