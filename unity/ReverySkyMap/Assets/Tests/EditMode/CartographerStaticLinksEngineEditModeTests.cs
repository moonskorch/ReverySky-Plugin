using NUnit.Framework;
using UnityEngine;

public class CartographerStaticLinksEngineEditModeTests
{
  [Test]
  public void CalculateBoundRadius_SameInputs_GiveSameResult()
  {
    float first = CartographerStaticLinksEngine.CalculateBoundRadius(200, 3.8f, 6f);
    float second = CartographerStaticLinksEngine.CalculateBoundRadius(200, 3.8f, 6f);

    Assert.That(first, Is.EqualTo(second));
  }

  [Test]
  public void CalculateBoundRadius_MoreNodes_GrowRadius()
  {
    float small = CartographerStaticLinksEngine.CalculateBoundRadius(50, 3.8f, 6f);
    float large = CartographerStaticLinksEngine.CalculateBoundRadius(1000, 3.8f, 6f);

    Assert.That(large, Is.GreaterThan(small));
  }

  [TestCase(0)]
  [TestCase(-10)]
  public void CalculateBoundRadius_ZeroOrNegativeInputs_AreNormalizedSafely(int totalNodeCount)
  {
    float radius = CartographerStaticLinksEngine.CalculateBoundRadius(totalNodeCount, 3.8f, 6f);

    Assert.That(radius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(radius), Is.False);
    Assert.That(float.IsInfinity(radius), Is.False);
  }

  [Test]
  public void CalculateBoundRadius_TenThousandNodes_RemainsFinite()
  {
    float radius = CartographerStaticLinksEngine.CalculateBoundRadius(10000, 3.8f, 6f);

    Assert.That(radius, Is.GreaterThan(0f));
    Assert.That(float.IsNaN(radius), Is.False);
    Assert.That(float.IsInfinity(radius), Is.False);
  }

  [Test]
  public void Engine_ExposesStaticContract()
  {
    GameObject gameObject = new GameObject("CartographerStaticLinksEngineEditModeTests");

    try
    {
      var engine = gameObject.AddComponent<CartographerStaticLinksEngine>();

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
