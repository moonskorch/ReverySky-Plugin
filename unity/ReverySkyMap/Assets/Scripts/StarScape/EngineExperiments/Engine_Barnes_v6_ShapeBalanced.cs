using System.Reflection;
using UnityEngine;

// Evaluation target:
// - Keep Barnes v5 build speed in the 501-2K node range.
// - Repair the tagged graph plate shape by restoring a little Barnes-Hut accuracy.
// - Give tagless graphs stronger direct-link structure without returning to a spindle seed.
[DisallowMultipleComponent]
public class Engine_Barnes_v6_ShapeBalanced : Engine_Barnes_v5_FasterMidSize
{
  private static readonly BindingFlags ProfileFieldFlags =
    BindingFlags.Instance | BindingFlags.NonPublic;

  private void Awake()
  {
    ApplyProfile();
  }

  private void Reset()
  {
    ApplyProfile();
  }

  private void OnValidate()
  {
    ApplyProfile();
  }

  private void ApplyProfile()
  {
    SetProfileValue("maxIterations", 34);
    SetProfileValue("minIterations", 14);
    SetProfileValue("largeGraphIterationFloor", 22);
    SetProfileValue("settleEpsilon", 0.026f);

    SetProfileValue("directLinkSpringStrength", 1.65f);
    SetProfileValue("noteTagSpringStrength", 0.92f);
    SetProfileValue("componentGravityStrength", 0.012f);

    SetProfileValue("barnesHutTheta", 0.98f);
    SetProfileValue("octreeLeafCapacity", 8);
    SetProfileValue("maxBarnesHutVisitsPerNode", 288);
    SetProfileValue("maxExactLeafChecksPerLeaf", 24);
  }

  private void SetProfileValue<T>(string fieldName, T value)
  {
    var field = typeof(Engine_Barnes_v5_FasterMidSize).GetField(
      fieldName,
      ProfileFieldFlags);

    if (field == null)
    {
      Debug.LogWarning($"[Barnes/v6] Missing profile field: {fieldName}");
      return;
    }

    field.SetValue(this, value);
  }
}
