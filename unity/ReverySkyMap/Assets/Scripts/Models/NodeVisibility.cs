using System;
using UnityEngine;

public sealed class NodeVisibility : MonoBehaviour, ICullingConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  public bool IsDistanceVisible { get; private set; }
  public LabelHighlightState HighlightState { get; private set; }

  public event Action<bool> OnDistanceVisibilityChanged;
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
    if (IsDistanceVisible == visible)
      return;

    IsDistanceVisible = visible;
    OnDistanceVisibilityChanged?.Invoke(IsDistanceVisible);
  }

  public void SetHighlightState(LabelHighlightState state)
  {
    if (HighlightState == state)
      return;

    HighlightState = state;
    OnHighlightStateChanged?.Invoke(HighlightState);
  }
}
