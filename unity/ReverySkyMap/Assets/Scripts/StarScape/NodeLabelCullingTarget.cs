using UnityEngine;

public sealed class NodeLabelCullingTarget : MonoBehaviour
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private GameObject labelRoot;
  [SerializeField] private Behaviour[] behavioursWhenVisible;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  public bool TryCreateEntry(out NodeLabelCullingManager.Entry entry)
  {
    entry = null;

    Transform reference = referenceTransform != null ? referenceTransform : transform;
    if (reference == null || labelRoot == null)
      return false;

    entry = new NodeLabelCullingManager.Entry
    {
      referenceTransform = reference,
      labelRoot = labelRoot,
      behavioursWhenVisible = behavioursWhenVisible,
      radius = Mathf.Max(0.01f, radius),
      visibleDistance = Mathf.Max(0.01f, visibleDistance)
    };

    return true;
  }
}
