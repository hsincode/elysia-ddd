CREATE SCHEMA "api";
--> statement-breakpoint
CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE SCHEMA "ordering";
--> statement-breakpoint
CREATE TABLE "api"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"response_headers" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "messaging"."deliveries" (
	"event_id" uuid NOT NULL,
	"subscriber" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deliveries_event_id_subscriber_pk" PRIMARY KEY("event_id","subscriber")
);
--> statement-breakpoint
CREATE TABLE "messaging"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"dead_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_sales" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"units_sold" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"status" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."reservation_lines" (
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "reservation_lines_order_id_product_id_pk" PRIMARY KEY("order_id","product_id"),
	CONSTRAINT "reservation_lines_quantity_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."reservations" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_items" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "stock_items_reserved_within_on_hand" CHECK (reserved >= 0 and reserved <= on_hand)
);
--> statement-breakpoint
CREATE TABLE "ordering"."order_lines" (
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "order_lines_order_id_line_no_pk" PRIMARY KEY("order_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "ordering"."orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text NOT NULL,
	"total" integer NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"tracking_number" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"rejected_at" timestamp with time zone,
	"unavailable_product_ids" uuid[],
	"version" integer NOT NULL,
	CONSTRAINT "orders_confirmed_has_time" CHECK (status not in ('confirmed', 'shipped') or confirmed_at is not null),
	CONSTRAINT "orders_shipped_has_tracking" CHECK (status <> 'shipped' or (shipped_at is not null and tracking_number is not null)),
	CONSTRAINT "orders_cancelled_has_reason" CHECK (status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)),
	CONSTRAINT "orders_rejected_has_products" CHECK (status <> 'rejected' or (rejected_at is not null and unavailable_product_ids is not null))
);
--> statement-breakpoint
ALTER TABLE "messaging"."deliveries" ADD CONSTRAINT "deliveries_event_id_outbox_id_fk" FOREIGN KEY ("event_id") REFERENCES "messaging"."outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."reservation_lines" ADD CONSTRAINT "reservation_lines_order_id_reservations_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "inventory"."reservations"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordering"."order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "api"."idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "messaging"."outbox" USING btree ("next_attempt_at","id") WHERE published_at is null and dead_at is null;--> statement-breakpoint
CREATE INDEX "outbox_pending_by_aggregate_idx" ON "messaging"."outbox" USING btree ("aggregate_id","id") WHERE published_at is null and dead_at is null;--> statement-breakpoint
CREATE INDEX "orders_placed_awaiting_idx" ON "ordering"."orders" USING btree ("placed_at") WHERE status = 'placed';