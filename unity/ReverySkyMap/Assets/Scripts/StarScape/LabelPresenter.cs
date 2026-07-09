using UnityEngine;

public sealed class LabelPresenter : MonoBehaviour, ICullingConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private GameObject labelRoot;
  [SerializeField] private Behaviour[] relatedBehaviours;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  public bool TryCreateDistanceEntry(Component node, out CullingManager.Entry entry)
  {
    entry = null;

    Transform reference = referenceTransform != null ? referenceTransform : transform;
    if (reference == null || labelRoot == null)
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
    if (labelRoot != null && labelRoot.activeSelf != visible)
      labelRoot.SetActive(visible);

    SetRelatedBehavioursVisible(visible);
  }

  private void SetRelatedBehavioursVisible(bool visible)
  {
    if (relatedBehaviours == null)
      return;

    for (int i = 0; i < relatedBehaviours.Length; i++)
    {
      Behaviour behaviour = relatedBehaviours[i];
      if (behaviour != null && behaviour.enabled != visible)
        behaviour.enabled = visible;
    }
  }
}
