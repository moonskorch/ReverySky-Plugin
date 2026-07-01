using UnityEngine;

public sealed class BehaviourCullingTarget : MonoBehaviour, ICullingConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private Behaviour behaviour;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    Transform reference = referenceTransform != null ? referenceTransform : transform;
    if (reference == null || behaviour == null)
      return false;

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
    if (behaviour != null && behaviour.enabled != visible)
      behaviour.enabled = visible;
  }
}
