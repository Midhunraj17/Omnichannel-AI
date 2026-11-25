from fastapi import APIRouter

from app.schemas.routing import RoutingRequest, RoutingResponse
from app.services.routing_engine import decide_route

router = APIRouter()


@router.post("/routing/decide", response_model=RoutingResponse)
def routing_decide(request: RoutingRequest):
    return decide_route(request.classification)
