using System;
using UnityEngine;

public sealed class NodeVisibility : MonoBehaviour, ICullingConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  private bool distanceVisible;

  public bool IsVisible { get; private set; }
  public LabelHighlightState HighlightState { get; private set; }

  public event Action<bool> OnVisibilityChanged;
  public event Action<LabelHighlightState> OnHighlightStateChanged;

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    Transform reference = referenceTransform != null ? referenceTransform : transform;

    entry = new CullingManager.Entry
    {
      node = node != null ? node : this,
      referenceTransform = reference,
      consumer = this,
      radius = radius,
      visibleDistance = visibleDistance
    };

    return true;
  }

  public void SetDistanceVisible(Component node, bool visible)
  {
    if (distanceVisible == visible)
      return;

    distanceVisible = visible;
    ApplyVisibility();
  }

  public void SetHighlightState(LabelHighlightState state)
  {
    if (HighlightState == state)
      return;

    HighlightState = state;
    OnHighlightStateChanged?.Invoke(HighlightState);
    ApplyVisibility();
  }

  private void ApplyVisibility()
  {
    bool visible = distanceVisible || HighlightState != LabelHighlightState.Normal;
    if (IsVisible == visible)
      return;

    IsVisible = visible;
    OnVisibilityChanged?.Invoke(IsVisible);
  }
}
