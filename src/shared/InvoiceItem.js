/**
 * InvoiceItem class for managing individual invoice line items
 */
class InvoiceItem {
    /**
     * Creates a new InvoiceItem instance
     * @param {string} itemId - Unique item identifier
     * @param {string} description - Item description
     * @param {number} unitPrice - Price per unit
     * @param {number} quantity - Quantity of items (default: 1)
     */
    constructor(itemId, description, unitPrice, quantity = 1) {
        this.itemId = itemId;
        this.description = description;
        this.unitPrice = unitPrice;
        this.quantity = quantity;
        this.lineTotal = this.calculateLineTotal();
    }

    /**
     * Calculate the line total (unitPrice * quantity)
     * @returns {number} Line total amount
     */
    calculateLineTotal() {
        this.lineTotal = this.unitPrice * this.quantity;
        return this.lineTotal;
    }

    /**
     * Update the quantity and recalculate line total
     * @param {number} newQuantity - New quantity value
     */
    setQuantity(newQuantity) {
        if (newQuantity >= 0) {
            this.quantity = newQuantity;
            this.calculateLineTotal();
        } else {
            throw new Error('Quantity cannot be negative');
        }
    }

    /**
     * Update the unit price and recalculate line total
     * @param {number} newUnitPrice - New unit price
     */
    setUnitPrice(newUnitPrice) {
        if (newUnitPrice >= 0) {
            this.unitPrice = newUnitPrice;
            this.calculateLineTotal();
        } else {
            throw new Error('Unit price cannot be negative');
        }
    }

    /**
     * Update the description
     * @param {string} newDescription - New description
     */
    setDescription(newDescription) {
        this.description = newDescription;
    }

    /**
     * Get item as a plain object
     * @returns {Object} InvoiceItem data as plain object
     */
    toObject() {
        return {
            itemId: this.itemId,
            description: this.description,
            unitPrice: this.unitPrice,
            quantity: this.quantity,
            lineTotal: this.lineTotal
        };
    }

    /**
     * Get item as JSON string
     * @returns {string} InvoiceItem data as JSON string
     */
    toJSON() {
        return JSON.stringify(this.toObject());
    }

    /**
     * Create an InvoiceItem instance from a plain object
     * @param {Object} data - Plain object with item data
     * @returns {InvoiceItem} New InvoiceItem instance
     */
    static fromObject(data) {
        const item = new InvoiceItem(
            data.itemId,
            data.description,
            data.unitPrice,
            data.quantity || 1
        );
        // If lineTotal is provided and different from calculated, use the provided value
        if (data.lineTotal !== undefined && data.lineTotal !== item.lineTotal) {
            item.lineTotal = data.lineTotal;
        }
        return item;
    }

    /**
     * Create an InvoiceItem instance from JSON string
     * @param {string} jsonString - JSON string with item data
     * @returns {InvoiceItem} New InvoiceItem instance
     */
    static fromJSON(jsonString) {
        const data = JSON.parse(jsonString);
        return InvoiceItem.fromObject(data);
    }

    /**
     * Validate that the item has all required fields
     * @returns {boolean} True if valid, false otherwise
     */
    isValid() {
        return !!(
            this.itemId &&
            this.description &&
            typeof this.unitPrice === 'number' &&
            typeof this.quantity === 'number' &&
            this.unitPrice >= 0 &&
            this.quantity >= 0
        );
    }

    /**
     * Get formatted currency amounts
     * @param {string} currency - Currency symbol (default: '£')
     * @returns {Object} Object with formatted currency strings
     */
    getFormattedAmounts(currency = '£') {
        return {
            unitPrice: `${currency}${this.unitPrice.toFixed(2)}`,
            lineTotal: `${currency}${this.lineTotal.toFixed(2)}`
        };
    }

    /**
     * Get a formatted string representation of the item
     * @param {string} currency - Currency symbol (default: '£')
     * @returns {string} Formatted item string
     */
    toString(currency = '£') {
        const formatted = this.getFormattedAmounts(currency);
        return `${this.description} (${this.quantity} x ${formatted.unitPrice}) = ${formatted.lineTotal}`;
    }

    /**
     * Apply a discount percentage to the unit price
     * @param {number} discountPercent - Discount percentage (0-100)
     * @returns {number} New unit price after discount
     */
    applyDiscount(discountPercent) {
        if (discountPercent < 0 || discountPercent > 100) {
            throw new Error('Discount percentage must be between 0 and 100');
        }
        const discountAmount = this.unitPrice * (discountPercent / 100);
        this.setUnitPrice(this.unitPrice - discountAmount);
        return this.unitPrice;
    }

    /**
     * Clone the current item
     * @returns {InvoiceItem} New InvoiceItem instance with same data
     */
    clone() {
        return InvoiceItem.fromObject(this.toObject());
    }
}

module.exports = InvoiceItem;
