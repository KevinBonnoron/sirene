from fastapi import APIRouter

from ..services.prompt_cache import get_cache

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get("")
async def cache_stats():
    return get_cache().stats()


@router.post("/clear")
async def clear_cache():
    result = get_cache().clear_all()
    return {"message": "Cache cleared", **result}


@router.post("/evict")
async def evict_cache():
    evicted = get_cache().evict_lru()
    return {"evicted": evicted, **get_cache().stats()}
