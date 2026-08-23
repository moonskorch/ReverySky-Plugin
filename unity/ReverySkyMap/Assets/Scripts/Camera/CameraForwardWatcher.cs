using System.Collections.Generic;
using UnityEngine;

public sealed class CameraForwardWatcher : MonoBehaviour
{
  private const float ForwardDotThreshold = 0.999999f;

  public static CameraForwardWatcher I { get; private set; }

  private readonly List<LookAtCamera> targets = new();
  private Vector3 lastForward;
  public Vector3 CurrentForward => transform.forward;

  private void Awake()
  {
    if (I != null) 
      Debug.LogError("More than one instance of CameraForwardWatcher");
    I = this;
    lastForward = transform.forward;
  }

  private void LateUpdate()
  {
    Vector3 forward = transform.forward;
    if (Vector3.Dot(lastForward, forward) >= ForwardDotThreshold)
      return;

    lastForward = forward;
    ApplyForward();
  }

  public void Register(LookAtCamera target)
  {
    if (!targets.Contains(target))
      targets.Add(target);

    target.ApplyCameraForward(CurrentForward);
  }

  public void Unregister(LookAtCamera target)
  {
    targets.Remove(target);
  }

  private void ApplyForward()
  {
    for (int i = 0; i < targets.Count; i++)
      targets[i].ApplyCameraForward(lastForward);
  }
}
