using UnityEngine;

public sealed class NodeLabelCullingTarget : MonoBehaviour
{
  [SerializeField] private Transform referenceTransform;
  [SerializeField] private GameObject labelRoot;
  [SerializeField] private Behaviour[] behavioursWhenVisible;
  [SerializeField, Min(0.01f)] private float radius = 1f;
  [SerializeField, Min(0.01f)] private float visibleDistance = 25f;

  private bool registered;
  private GameObject resolvedLabelRoot;

  private void OnEnable()
  {
    Register();
  }

  private void Start()
  {
    Register();
  }

  private void OnDisable()
  {
    if (!registered || NodeLabelCullingManager.Active == null)
      return;

    NodeLabelCullingManager.Active.Unregister(resolvedLabelRoot);
    registered = false;
    resolvedLabelRoot = null;
  }

  private void Register()
  {
    if (registered || NodeLabelCullingManager.Active == null)
      return;

    Transform reference = referenceTransform != null ? referenceTransform : transform;
    resolvedLabelRoot = labelRoot;
    if (resolvedLabelRoot == null)
      return;

    registered = NodeLabelCullingManager.Active.Register(
      reference,
      resolvedLabelRoot,
      behavioursWhenVisible,
      radius,
      visibleDistance) >= 0;
  }
}
