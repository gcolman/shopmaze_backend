# Order Processing Sequence Diagram

This diagram shows the complete flow from receiving an 'order' message on the WebSocket to invoice processing.

```mermaid
sequenceDiagram
    participant Client as Game Client
    participant WS as WebSocket Server
    participant HTTP as HTTP Server
    participant OP as OrderProcessor
    participant Backend as External Backend API
    participant WSC as WebSocket Client
    participant IP as InvoicePoller
    participant S3 as S3 Bucket

    Note over Client, S3: Order Processing Flow

    Client->>WS: WebSocket Message<br/>{type: 'order', data: orderData}
    WS->>WS: Log received order event
    WS->>HTTP: POST /process-order<br/>(orderData.data)
    
    HTTP->>OP: handleOrderRequest(req, res)
    OP->>OP: validateOrder(orderData)
    
    alt Order Validation Fails
        OP-->>HTTP: Return validation error
        HTTP-->>WS: HTTP error response
        WS-->>Client: order_response (error)
    else Order Validation Passes
        OP->>Backend: POST order data<br/>(External API)
        Backend-->>OP: Response with PO number<br/>{po: "1234", summary: {...}}
        OP-->>HTTP: Return success result<br/>{orderId, backendResponse}
        
        HTTP->>WSC: Send expected invoice message<br/>{type: 'register_expected_invoice'}
        WSC->>WS: Forward to WebSocket server
        
        WS->>IP: registerExpectedInvoice(invoiceNumber, playerId, orderData)
        IP->>IP: Store in expectedInvoices Map
        
        WS-->>WSC: register_expected_invoice_response (success)
        WSC-->>HTTP: Confirmation
        HTTP-->>WS: HTTP success response
        WS-->>Client: order_response (success)
    end

    Note over IP, S3: Invoice Monitoring Phase

    loop Every 5 seconds (polling)
        IP->>S3: listObjects() - Check for new invoices
        S3-->>IP: Return invoice files
        
        alt Expected invoice found
            IP->>S3: getObject() - Download PDF
            S3-->>IP: Return PDF data
            IP->>IP: Convert PDF to base64
            IP->>IP: saveInvoiceToFilesystem()
            IP->>IP: Add to processedInvoicesCache
            
            IP->>WS: invoiceProcessedCallback(invoiceNumber, processedData)
            WS->>Client: invoice_ready notification<br/>{type: 'invoice_ready', invoiceNumber}
            
            IP->>IP: Remove from expectedInvoices
        end
    end

    Note over Client, S3: Invoice Request Flow

    Client->>WS: request_invoice<br/>{type: 'request_invoice', invoiceNumber}
    WS->>IP: getProcessedInvoice(invoiceNumber)
    IP->>IP: fetchInvoiceFromFilesystem()
    IP-->>WS: Return invoice data with base64
    WS-->>Client: invoice_pdf<br/>{type: 'invoice_pdf', base64Data, ...}
```

## Key Components

### 1. **Order Processing Chain**
- Client sends order via WebSocket
- WebSocket server forwards to HTTP server
- HTTP server validates and processes via OrderProcessor
- OrderProcessor forwards to external backend API
- Response flows back through the chain

### 2. **Invoice Registration**
- HTTP server sends expected invoice registration to WebSocket server
- WebSocket server registers invoice in InvoicePoller
- InvoicePoller starts monitoring S3 for the invoice PDF

### 3. **Invoice Monitoring**
- InvoicePoller continuously polls S3 every 5 seconds
- When expected invoice PDF is found, it's processed and stored
- Client receives invoice_ready notification via WebSocket

### 4. **Invoice Retrieval**
- Client can request specific invoices via WebSocket
- InvoicePoller retrieves from filesystem and sends base64 data
- Client receives full invoice PDF data for display

## Error Handling

The flow includes comprehensive error handling at each step:
- Order validation errors
- Backend API communication failures
- WebSocket connection issues
- S3 access problems
- Invoice processing failures

Each error is properly logged and appropriate error responses are sent back to the client.
