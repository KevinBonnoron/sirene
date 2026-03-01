from fastapi import APIRouter

from ..services.prompt_cache import get_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get("")
async def cache_stats():
    """Return cache statistics."""
    return get_cache().stats()


@router.post("/clear")
async def clear_cache():
    """Clear all voice prompt caches."""
    result = get_cache().clear_all()
    return {"message": "Cache cleared", **result}


@router.post("/evict")
async def evict_cache():
    """Run LRU eviction to enforce disk size limits."""
    evicted = get_cache().evict_lru()
    return {"evicted": evicted, **get_cache().stats()}
