using UnityEngine;

// Evaluation target:
// - Keep Barnes v3 center correction.
// - Remove the tagless vertical spindle caused by ordered Fibonacci volume seeding.
[DisallowMultipleComponent]
public class Engine_Barnes_v4_TaglessIsotropicSeed : Engine_Barnes_v3_Recentered
{
  private const float VOLUME_GOLDEN_RATIO_FRACTION = 0.61803398875f;

  protected override void AfterInitializeStablePositions()
  {
    if (!IsTaglessGraph())
      return;

    for (int componentIndex = 0; componentIndex < _components.Count; componentIndex++)
      ReseedComponent(_components[componentIndex]);
  }

  private bool IsTaglessGraph()
  {
    if (_nodes.Count == 0)
      return false;

    for (int i = 0; i < _nodes.Count; i++)
      if (!_nodes[i].IsNote)
        return false;

    return true;
  }

  private void ReseedComponent(Component component)
  {
    int count = component.Nodes.Count;
    if (count <= 0)
      return;

    float localSpread = 0f;
    for (int offset = 0; offset < count; offset++)
    {
      var node = _nodes[component.Nodes[offset]];
      localSpread = Mathf.Max(
        localSpread,
        Vector3.Distance(component.Center, node.Position));
    }

    localSpread = Mathf.Max(MinimumNodeDistance * 2f, localSpread);

    for (int offset = 0; offset < count; offset++)
    {
      var node = _nodes[component.Nodes[offset]];
      Vector3 seed =
        component.Center +
        ScrambledBallPoint(offset, count, node.Key) * localSpread;

      node.ComponentCenter = component.Center;
      node.Position = ClampToSphere(seed, MinimumNodeDistance * 0.5f);
      node.InitialPosition = node.Position;
      node.Velocity = Vector3.zero;
      node.Force = Vector3.zero;
    }
  }

  private static Vector3 ScrambledBallPoint(int index, int count, string key)
  {
    if (count <= 1)
      return Vector3.zero;

    Vector3 direction = StableDirection(key, 701);
    float radialSample = Mathf.Repeat(
      (index + 0.5f) * VOLUME_GOLDEN_RATIO_FRACTION,
      1f);
    float radius = Mathf.Pow(
      Mathf.Lerp(0.08f, 1f, radialSample),
      1f / 3f);

    return direction * radius;
  }

  private static Vector3 StableDirection(string key, int salt)
  {
    float y = Mathf.Lerp(-1f, 1f, Hash01(key, salt));
    float radial = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
    float angle = Hash01(key, salt + 1) * Mathf.PI * 2f;

    return new Vector3(
      Mathf.Cos(angle) * radial,
      y,
      Mathf.Sin(angle) * radial);
  }

  private static float Hash01(string value, int salt)
  {
    return (StableHash(value, salt) & 0x00FFFFFFu) / 16777215f;
  }

  private static uint StableHash(string value, int salt)
  {
    unchecked
    {
      uint hash = (2166136261u ^ (uint)salt) * 16777619u;
      string safe = value ?? string.Empty;

      for (int i = 0; i < safe.Length; i++)
        hash = (hash ^ safe[i]) * 16777619u;

      return hash;
    }
  }
}
