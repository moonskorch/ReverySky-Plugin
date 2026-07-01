using UnityEngine;

public sealed class NodeLabelCullingTarget : MonoBehaviour, INodeDistanceVisibilityConsumer
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private GameObject labelRoot;
  [SerializeField] private Behaviour[] behavioursWhenVisible;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  public bool TryCreateDistanceEntry(out NodeDistanceCullingManager.Entry entry)
  {
    entry = null;

    Transform reference = referenceTransform != null ? referenceTransform : transform;
    if (reference == null || labelRoot == null)
      return false;

    entry = new NodeDistanceCullingManager.Entry
    {
      node = this,
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

    if (behavioursWhenVisible == null)
      return;

    for (int i = 0; i < behavioursWhenVisible.Length; i++)
    {
      Behaviour behaviour = behavioursWhenVisible[i];
      if (behaviour != null)
        behaviour.enabled = visible;
    }
  }
}
