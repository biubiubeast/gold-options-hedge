CREATE TABLE `formulas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`category` varchar(50) NOT NULL,
	`expression` text NOT NULL,
	`description` text,
	`usedIn` text,
	`isDefault` int NOT NULL DEFAULT 1,
	`defaultExpression` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `formulas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`underlying` enum('XAUT','GLD') NOT NULL,
	`expiry` varchar(20) NOT NULL,
	`strike` decimal(12,2) NOT NULL,
	`optionType` enum('call','put') NOT NULL,
	`entryPrice` decimal(14,6) NOT NULL,
	`quantity` decimal(12,4) NOT NULL,
	`fee` decimal(12,6) NOT NULL DEFAULT '0',
	`entryDelta` decimal(8,6) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
