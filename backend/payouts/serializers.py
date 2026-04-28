from rest_framework import serializers

from .models import LedgerEntry, Merchant, Payout


class MerchantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Merchant
        fields = ['id', 'name', 'created_at']


class BalanceSerializer(serializers.Serializer):
    available_paise = serializers.IntegerField()
    held_paise = serializers.IntegerField()
    available_inr = serializers.SerializerMethodField()
    held_inr = serializers.SerializerMethodField()

    def get_available_inr(self, obj):
        return f"{obj['available_paise'] / 100:.2f}"

    def get_held_inr(self, obj):
        return f"{obj['held_paise'] / 100:.2f}"


class LedgerEntrySerializer(serializers.ModelSerializer):
    amount_inr = serializers.SerializerMethodField()

    class Meta:
        model = LedgerEntry
        fields = ['id', 'merchant_id', 'amount_paise', 'amount_inr', 'entry_type', 'reference_id', 'created_at']

    def get_amount_inr(self, obj):
        return f"{obj.amount_paise / 100:.2f}"


class PayoutSerializer(serializers.ModelSerializer):
    amount_inr = serializers.SerializerMethodField()

    class Meta:
        model = Payout
        fields = ['id', 'amount_paise', 'amount_inr', 'status', 'created_at', 'updated_at']

    def get_amount_inr(self, obj):
        return f"{obj.amount_paise / 100:.2f}"
