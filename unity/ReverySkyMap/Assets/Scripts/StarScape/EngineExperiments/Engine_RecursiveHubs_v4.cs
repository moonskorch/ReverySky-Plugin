using System.Reflection;
using UnityEngine;

/// <summary>
/// [Cartographer] Graph built in 1369,1 ms (notes=2000, engine=StaticLinks)
/// Overall: the bug was not fixed, so this version was rejected.
/// <summary/>


// Evaluation:
// - Safety wrapper for Engine_RecursiveHubs_v3.
// - Purpose: keep the v3 structural-hub algorithm, but avoid the play-mode
//   failure mode where Cartographer returns from BuildGraph while the engine is
//   still progressively materializing nodes.
// - The camera/focus stack assumes the active engine can resolve selected stars
//   immediately after BuildGraph(). v3 can violate that assumption when
//   animateConstruction is enabled, leaving focus/navigation to chase objects
//   while the graph is still in flight.
// - v4 therefore forces synchronous construction and leaves only post-placement
//   refinement animated. This is intentionally a separate version so v3 remains
//   available for visualizing construction waves.
//
// Assessment:
// - Pending manual validation in Play Mode on the map that reproduces the
//   CameraOrbitalController ActivePivotPos NullReferenceException.

/// <summary>
/// Safer v4 variant of the recursive-hub experiment.
///
/// Inherits the v3 structural algorithm, but forces all nodes to be placed and
/// instantiated during BuildGraph() so camera focus never points into an
/// unfinished construction pass.
/// </summary>
[DisallowMultipleComponent]
public class Engine_RecursiveHubs_v4 : Engine_RecursiveHubs_v3
{
  private const BindingFlags PrivateInstance =
    BindingFlags.Instance | BindingFlags.NonPublic;

  private static readonly FieldInfo AnimateConstructionField =
    typeof(Engine_RecursiveHubs_v3).GetField(
      "animateConstruction",
      PrivateInstance);

  private static readonly FieldInfo ConstructionActiveField =
    typeof(Engine_RecursiveHubs_v3).GetField(
      "_constructionActive",
      PrivateInstance);

  private static readonly FieldInfo MinimumNavigationRadiusField =
    typeof(Engine_RecursiveHubs_v3).GetField(
      "minimumNavigationRadius",
      PrivateInstance);

  private static readonly FieldInfo NavigationRadiusField =
    typeof(Engine_RecursiveHubs_v3).GetField(
      "_navigationRadius",
      PrivateInstance);

  private void Awake()
  {
    ForceSynchronousConstruction();
    InitializeNavigationRadiusFallback();
  }

  private void OnEnable()
  {
    ForceSynchronousConstruction();
  }

#if UNITY_EDITOR
  private void OnValidate()
  {
    ForceSynchronousConstruction();
  }
#endif

  private void ForceSynchronousConstruction()
  {
    AnimateConstructionField?.SetValue(this, false);
    ConstructionActiveField?.SetValue(this, false);
  }

  private void InitializeNavigationRadiusFallback()
  {
    if (MinimumNavigationRadiusField == null || NavigationRadiusField == null)
      return;

    float minimumNavigationRadius =
      Mathf.Max(0.1f, (float)MinimumNavigationRadiusField.GetValue(this));

    NavigationRadiusField.SetValue(this, minimumNavigationRadius);
  }
}
