using UnityEngine;

/// <summary>
/// Version 1 with the center fix. It appears to take slightly longer to load.
/// </summary>

// Evaluation target:
// - Keep Engine_Barnes_v1 physics and visual character.
// - Only remove accumulated translation drift so sphere clamping stays centered.
[DisallowMultipleComponent]
public class Engine_Barnes_v3_Recentered : Engine_Barnes_v1
{
  protected override float AfterLayoutIteration()
  {
    return RecenterLayout();
  }

  protected override void AfterResidualOverlaps()
  {
    RecenterLayout();
  }

  private float RecenterLayout()
  {
    if (_nodes.Count == 0)
      return 0f;

    Vector3 center = Vector3.zero;
    for (int i = 0; i < _nodes.Count; i++)
      center += _nodes[i].Position;

    center /= _nodes.Count;
    if (center.sqrMagnitude <= MIN_SQR_DISTANCE)
      return 0f;

    float margin = Mathf.Max(0.01f, MinimumNodeDistance) * 0.5f;
    for (int i = 0; i < _nodes.Count; i++)
      _nodes[i].Position = ClampToSphere(_nodes[i].Position - center, margin);

    return center.magnitude * _nodes.Count;
  }
}
