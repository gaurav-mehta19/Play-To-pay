import uuid

from django.http import HttpResponse
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import repository, service
from .serializers import BalanceSerializer, LedgerEntrySerializer, MerchantSerializer, PayoutSerializer


class StandardPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100


class MerchantListView(APIView):
    def get(self, request):
        merchants = repository.get_all_merchants()
        serializer = MerchantSerializer(merchants, many=True)
        return Response(serializer.data)


class MerchantBalanceView(APIView):
    def get(self, request, merchant_id):
        try:
            balance = service.get_balance(merchant_id)
        except Exception:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = BalanceSerializer(balance)
        return Response(serializer.data)


class MerchantLedgerView(APIView):
    def get(self, request, merchant_id):
        try:
            repository.get_merchant(merchant_id)
        except Exception:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)

        qs = repository.get_ledger_for_merchant(merchant_id)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = LedgerEntrySerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class MerchantPayoutsView(APIView):
    def get(self, request, merchant_id):
        try:
            repository.get_merchant(merchant_id)
        except Exception:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)

        qs = repository.get_payouts_for_merchant(merchant_id)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = PayoutSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class PayoutCreateView(APIView):
    def post(self, request):
        idempotency_key = request.headers.get('Idempotency-Key', '').strip()

        if not idempotency_key:
            return Response(
                {'error': 'Idempotency-Key header is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            uuid.UUID(idempotency_key)
        except ValueError:
            return Response(
                {'error': 'Idempotency-Key must be a valid UUID'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        merchant_id = request.data.get('merchant_id')
        amount_paise = request.data.get('amount_paise')
        bank_account_id = request.data.get('bank_account_id')

        if not merchant_id:
            return Response({'error': 'merchant_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        if amount_paise is None:
            return Response({'error': 'amount_paise is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not bank_account_id:
            return Response({'error': 'bank_account_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            amount_paise = int(amount_paise)
        except (TypeError, ValueError):
            return Response({'error': 'amount_paise must be an integer'}, status=status.HTTP_400_BAD_REQUEST)

        if amount_paise <= 0:
            return Response({'error': 'amount_paise must be positive'}, status=status.HTTP_400_BAD_REQUEST)

        response_data, http_status = service.create_payout(
            merchant_id=merchant_id,
            amount_paise=amount_paise,
            bank_account_id=bank_account_id,
            idempotency_key=idempotency_key,
        )
        if isinstance(response_data, str):
            return HttpResponse(response_data, content_type='application/json', status=http_status)
        return Response(response_data, status=http_status)


class PayoutDetailView(APIView):
    def get(self, request, payout_id):
        try:
            payout = repository.get_payout(payout_id)
        except Exception:
            return Response({'error': 'Payout not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = PayoutSerializer(payout)
        return Response(serializer.data)
