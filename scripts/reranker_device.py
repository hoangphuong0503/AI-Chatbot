"""Backend selection separated from model loading so it is testable without torch."""


def select_device(torch, requested='auto'):
    if requested not in ('auto', 'cpu', 'cuda', 'mps'):
        raise ValueError('LOCAL_RERANKER_DEVICE must be auto, cpu, cuda or mps')
    cuda = torch.cuda.is_available()
    mps = getattr(torch.backends, 'mps', None)
    mps = bool(mps is not None and mps.is_available())
    if requested == 'auto':
        return 'cuda' if cuda else 'mps' if mps else 'cpu'
    if requested == 'cuda' and not cuda:
        raise ValueError('CUDA is unavailable; use LOCAL_RERANKER_DEVICE=auto or cpu')
    if requested == 'mps' and not mps:
        raise ValueError('Apple MPS is unavailable; use LOCAL_RERANKER_DEVICE=cpu')
    return requested
