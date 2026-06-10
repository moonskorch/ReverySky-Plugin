using NUnit.Framework;
using UnityEngine;

public class CartographerStaticLinksEngineEditModeTests
{
  [Test]
  public void CalculateBoundRadius_SameInputs_GiveSameResult()
  {
    float first = Engine_EmptySpheres.CalculateBoundRadius(200, 3.8f, 6f);
    float second = Engine_EmptySpheres.CalculateBoundRadius(200, 3.8f, 6f);

    Assert.That(first, Is.EqualTo(second));
  }

  [Test]
  public void CalculateBoundRadius_MoreNodes_GrowRadius()
  {
    float small = Engine_EmptySpheres.CalculateBoundRadius(50, 3.8f, 6f);
    float large = Engine_EmptySpheres.CalculateBoundRadius(1000, 3.8f, 6f);

    Assert.That(large, Is.GreaterThan(small));
  }

  [TestCase(0)]
  [TestCase(-10)]
  public void CalculateBoundRadius_ZeroOrNegativeInputs_AreNormalizedSafely(int totalNodeCount)
  {
    float radius = Engine_EmptySpheres.CalculateBoundRadius(totalNodeCount, 3.8f, 6f);

    Assert.That(radius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(radius), Is.False);
    Assert.That(float.IsInfinity(radius), Is.False);
  }

  [Test]
  public void CalculateBoundRadius_TenThousandNodes_RemainsFinite()
  {
    float radius = Engine_EmptySpheres.CalculateBoundRadius(10000, 3.8f, 6f);

    Assert.That(radius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(radius), Is.False);
    Assert.That(float.IsInfinity(radius), Is.False);
  }

  [Test]
  public void CalculateTaglessComponentRadius_MoreNotesGrowRadius()
  {
    float small =
      Engine_EmptySpheres.CalculateTaglessComponentRadius(
        100,
        10f,
        10f);

    float large =
      Engine_EmptySpheres.CalculateTaglessComponentRadius(
        10000,
        10f,
        10f);

    Assert.That(large, Is.GreaterThan(small));
  }

  [Test]
  public void CalculateTaglessComponentsBoundRadius_MultipleComponentsRequireMoreRoom()
  {
    float one =
      Engine_EmptySpheres.CalculateTaglessComponentsBoundRadius(
        new[] { 10000 },
        10f,
        10f,
        6f);

    float four =
      Engine_EmptySpheres.CalculateTaglessComponentsBoundRadius(
        new[] { 2500, 2500, 2500, 2500 },
        10f,
        10f,
        6f);

    Assert.That(four, Is.GreaterThan(one));
  }

  [Test]
  public void CalculateTaglessComponentsBoundRadius_SameInputsGiveSameResult()
  {
    float first =
      Engine_EmptySpheres.CalculateTaglessComponentsBoundRadius(
        new[] { 2500, 2500, 2500, 2500 },
        10f,
        10f,
        6f);

    float second =
      Engine_EmptySpheres.CalculateTaglessComponentsBoundRadius(
        new[] { 2500, 2500, 2500, 2500 },
        10f,
        10f,
        6f);

    Assert.That(first, Is.EqualTo(second));
  }

  [Test]
  public void CalculateTaglessComponentsBoundRadius_EmptyInputIsSafe()
  {
    float result =
      Engine_EmptySpheres.CalculateTaglessComponentsBoundRadius(
        System.Array.Empty<int>(),
        10f,
        10f,
        6f);

    Assert.That(result, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(result), Is.False);
    Assert.That(float.IsInfinity(result), Is.False);
  }

  [Test]
  public void Engine_ExposesStaticContract()
  {
    GameObject gameObject = new GameObject("CartographerStaticLinksEngineEditModeTests");

    try
    {
      var engine = gameObject.AddComponent<Engine_EmptySpheres>();

      Assert.That(engine.EngineType, Is.EqualTo(CartographerEngine.StaticLinks));
      Assert.That(engine.RequiresTick, Is.False);
      Assert.That(engine.ScapeWarper, Is.Null);
    }
    finally
    {
      Object.DestroyImmediate(gameObject);
    }
  }
}
