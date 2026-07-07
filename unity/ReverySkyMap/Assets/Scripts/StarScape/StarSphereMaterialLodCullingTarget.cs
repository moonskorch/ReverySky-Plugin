using UnityEngine;

public sealed class StarSphereMaterialLodCullingTarget : MonoBehaviour, ICullingConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private StarVisual starVisual;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float richMaterialDistance = 60f;

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    Transform reference = referenceTransform != null ? referenceTransform : transform;
    if (reference == null || ResolveStarVisual() == null)
      return false;

    entry = new CullingManager.Entry
    {
      node = node != null ? node : this,
      referenceTransform = reference,
      consumer = this,
      radius = radius,
      visibleDistance = richMaterialDistance
    };

    return true;
  }

  public void SetDistanceVisible(Component node, bool visible)
  {
    StarVisual visual = ResolveStarVisual();
    if (visual != null)
      visual.SetSphereMaterialLod(!visible);
  }

  private StarVisual ResolveStarVisual()
  {
    if (starVisual != null)
      return starVisual;

    starVisual = GetComponent<StarVisual>();
    return starVisual;
  }
}
