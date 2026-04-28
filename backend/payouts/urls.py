from django.urls import path

from .views import (
    MerchantBalanceView,
    MerchantLedgerView,
    MerchantListView,
    MerchantPayoutsView,
    PayoutCreateView,
    PayoutDetailView,
)

urlpatterns = [
    path('merchants/', MerchantListView.as_view(), name='merchant-list'),
    path('merchants/<uuid:merchant_id>/balance/', MerchantBalanceView.as_view(), name='merchant-balance'),
    path('merchants/<uuid:merchant_id>/ledger/', MerchantLedgerView.as_view(), name='merchant-ledger'),
    path('merchants/<uuid:merchant_id>/payouts/', MerchantPayoutsView.as_view(), name='merchant-payouts'),
    path('payouts/', PayoutCreateView.as_view(), name='payout-create'),
    path('payouts/<uuid:payout_id>/', PayoutDetailView.as_view(), name='payout-detail'),
]
